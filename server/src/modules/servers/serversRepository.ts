import crypto from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, serverBans, serverCategories, serverMembers, serverRoles, servers } from '../../db/schema.js';
import type { Locale } from '../users/locale.js';
import type { Tx } from '../users/userPairLock.js';
import { defaultServerTemplate, type ChannelType } from './serverTemplate.js';

type Executor = Tx | typeof db;

// LOCK ORDER for every server operation: the user-pair advisory lock (only
// friend invitations take it), then the server row, then any invitation row.

export const lockServer = (tx: Tx, serverId: string) => tx.execute(sql`select id from servers where id = ${serverId} for update`);

export function sanitizeServerName(name: unknown): string | null {
  const s = String(name == null ? '' : name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
  return s || null;
}

/** Text channels read like Discord's (`chat-geral`): lowercase, no spaces.
 * Voice channels and categories keep the name as typed. */
export function sanitizeChannelName(name: unknown, type: ChannelType): string | null {
  let s = String(name == null ? '' : name).replace(/[\r\n\t]+/g, ' ').trim();
  if (type === 'text') s = s.toLocaleLowerCase().replace(/\s+/g, '-').replace(/-{2,}/g, '-');
  s = s.slice(0, 80);
  return s || null;
}

export function sanitizeCategoryName(name: unknown): string | null {
  const s = String(name == null ? '' : name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 100);
  return s || null;
}

export function sanitizeTopic(topic: unknown): string {
  return String(topic == null ? '' : topic).replace(/\r\n?/g, '\n').trim().slice(0, 1024);
}

export interface CreatedServer { serverId: string; firstTextChannelId: string }

/** A new server laid out from the template, owned by its creator — its only
 * member until someone accepts an invitation or uses a link. */
export async function createServer(ownerId: string, name: string, locale: Locale, executor?: Tx): Promise<CreatedServer> {
  const run = async (tx: Tx): Promise<CreatedServer> => {
    const template = defaultServerTemplate(locale);
    const serverId = crypto.randomUUID();
    const now = new Date();
    await tx.insert(servers).values({ id: serverId, name, ownerId, createdAt: now, updatedAt: now });
    await tx.insert(serverRoles).values({
      id: crypto.randomUUID(), serverId, name: '@everyone', position: 0, permissions: template.everyonePermissions, isDefault: true,
    });
    let firstTextChannelId = '';
    for (const [categoryIndex, category] of template.categories.entries()) {
      const categoryId = crypto.randomUUID();
      await tx.insert(serverCategories).values({ id: categoryId, serverId, name: category.name, position: categoryIndex });
      for (const [channelIndex, channel] of category.channels.entries()) {
        const id = crypto.randomUUID();
        if (!firstTextChannelId && channel.type === 'text') firstTextChannelId = id;
        await tx.insert(conversations).values({
          id, type: channel.type, title: channel.name, createdBy: ownerId, serverId, categoryId, position: channelIndex, updatedAt: now,
        });
      }
    }
    await addServerMember(tx, serverId, ownerId);
    return { serverId, firstTextChannelId };
  };
  return executor ? run(executor) : db.transaction(run);
}

/** Adds a member at the end of their own rail. Returns false when they
 * already were one. */
export async function addServerMember(tx: Tx, serverId: string, userId: string): Promise<boolean> {
  const [row] = await tx.select({ next: sql<number>`coalesce(max(${serverMembers.position}) + 1, 0)::int` })
    .from(serverMembers).where(eq(serverMembers.userId, userId));
  const inserted = await tx.insert(serverMembers).values({ serverId, userId, position: row?.next ?? 0 }).onConflictDoNothing().returning();
  return inserted.length > 0;
}

export async function serverMemberIds(serverId: string, executor: Executor = db): Promise<string[]> {
  const rows = await executor.select({ userId: serverMembers.userId }).from(serverMembers).where(eq(serverMembers.serverId, serverId));
  return rows.map((r) => r.userId);
}

export async function isServerMember(serverId: string, userId: string, executor: Executor = db): Promise<boolean> {
  const [row] = await executor.select({ userId: serverMembers.userId }).from(serverMembers)
    .where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, userId))).limit(1);
  return !!row;
}

export async function isBanned(serverId: string, userId: string, executor: Executor = db): Promise<boolean> {
  const [row] = await executor.select({ userId: serverBans.userId }).from(serverBans)
    .where(and(eq(serverBans.serverId, serverId), eq(serverBans.userId, userId))).limit(1);
  return !!row;
}

export async function countServerMembers(serverId: string, executor: Executor = db): Promise<number> {
  const [row] = await executor.select({ n: sql<number>`count(*)::int` }).from(serverMembers).where(eq(serverMembers.serverId, serverId));
  return row?.n ?? 0;
}

export interface SharedServer { id: string; name: string; icon: string; memberCount: number }

/** The active servers both `a` and `b` belong to, by name: a profile's
 * servers in common. Stops at `limit`; `total` is the full count. */
export async function listSharedServers(a: string, b: string, limit: number): Promise<{ items: SharedServer[]; total: number }> {
  const memberOf = (userId: string) => sql`${servers.id} IN (select ${serverMembers.serverId} from ${serverMembers} where ${serverMembers.userId} = ${userId})`;
  const rows = await db
    .select({
      id: servers.id,
      name: servers.name,
      icon: servers.icon,
      memberCount: sql<number>`(select count(*)::int from ${serverMembers} where ${serverMembers.serverId} = ${servers.id})`,
      total: sql<number>`(count(*) over ())::int`,
    })
    .from(servers)
    .where(and(eq(servers.status, 'active'), memberOf(a), memberOf(b)))
    .orderBy(sql`lower(${servers.name})`, servers.id)
    .limit(limit);
  return { items: rows.map(({ total: _total, ...server }) => server), total: rows[0]?.total ?? 0 };
}

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, serverMembers, servers } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { deleteServerCompletely } from '../servers/serverDeletion.js';
import { pageServerMembers } from '../servers/serverMembers.js';
import { invalidateServer } from '../servers/serverAccess.js';
import { sendServerUpdateToMembers } from '../servers/serverSummaries.js';
import { serverMemberIds } from '../servers/serversRepository.js';
import { revokeCallAccess } from '../calls/callAccess.js';
import { recordAudit, recordAuditFailure, listAudit, type AuditActor } from './auditLog.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'admin' });

interface Ctx { actor: AuditActor; reason: string; requestId: string }

export type ServerActionResult = { code: 'ok' } | { code: 'not_found' | 'already_suspended' | 'not_suspended' | 'not_member' };

const createdAtIso = sql<string>`to_char(${servers.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
// Written with an explicit alias: in a single-table select drizzle leaves
// column names unqualified, and an unqualified "id" inside a conversations
// subquery would be the channel's own id, not the server's.
const SERVER_ID = sql.raw('"servers"."id"');
const memberCountOf = sql<number>`(select count(*)::int from server_members m where m.server_id = ${SERVER_ID})`;
const channelCountOf = sql<number>`(select count(*)::int from conversations c where c.server_id = ${SERVER_ID})`;
const lastMessageOf = sql<Date | null>`(select max(c.last_message_at) from conversations c where c.server_id = ${SERVER_ID})`;

export interface AdminServerRow {
  id: string; name: string; icon: string; status: string; memberCount: number; channelCount: number;
  ownerId: string | null; ownerUsername: string | null; createdAt: string; lastMessageAt: number | null;
}

export interface AdminServerFilters { q?: string; status?: string; orphan?: boolean }

const serverSelect = {
  server: servers, ts: createdAtIso, memberCount: memberCountOf, channelCount: channelCountOf, lastMessageAt: lastMessageOf,
  ownerUsername: sql<string | null>`(select u.username from users u where u.id = ${sql.raw('"servers"."owner_id"')})`,
};

function toRow(r: { server: typeof servers.$inferSelect; ts: string; memberCount: number; channelCount: number; lastMessageAt: Date | string | null; ownerUsername: string | null }): AdminServerRow {
  return {
    id: r.server.id, name: r.server.name, icon: r.server.icon, status: r.server.status, memberCount: r.memberCount, channelCount: r.channelCount,
    ownerId: r.server.ownerId, ownerUsername: r.ownerUsername, createdAt: r.ts,
    lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt).getTime() : null,
  };
}

export async function listAdminServers(filters: AdminServerFilters, cursorRaw?: string): Promise<{ items: AdminServerRow[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const q = filters.q?.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db
    .select(serverSelect)
    .from(servers)
    .where(and(
      q ? sql`(lower(${servers.name}) like ${`%${q}%`} or ${servers.id} = ${filters.q?.trim() ?? ''})` : undefined,
      filters.status === 'active' || filters.status === 'suspended' ? eq(servers.status, filters.status) : undefined,
      filters.orphan ? sql`${servers.ownerId} is null` : undefined,
      cursor ? sql`(${servers.createdAt}, ${servers.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(servers.createdAt), desc(servers.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(toRow),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.server.id) : null,
  };
}

/** Administrative detail — reads the server WITHOUT joining it: the admin
 * gets who is in it and its channel names, never what is said there. */
export async function getAdminServer(serverId: string, membersCursor?: string) {
  const [row] = await db.select(serverSelect).from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!row) return null;
  const [members, channels, history] = await Promise.all([
    pageServerMembers(serverId, membersCursor),
    db.select({ id: conversations.id, type: conversations.type, name: conversations.title }).from(conversations)
      .where(eq(conversations.serverId, serverId)).orderBy(conversations.position),
    listAudit({ targetType: 'server', targetId: serverId }),
  ]);
  return {
    server: { ...toRow(row), statusReason: row.server.statusReason },
    channels,
    members: members === 'not_found' || members === 'invalid_cursor' ? { items: [], nextCursor: null } : members,
    history: history === 'invalid_cursor' ? [] : history.items,
  };
}

async function announce(serverId: string): Promise<void> {
  invalidateServer(serverId);
  await sendServerUpdateToMembers(serverId);
}

export async function suspendServer(ctx: Ctx, serverId: string): Promise<ServerActionResult> {
  const outcome = await db.transaction(async (tx): Promise<ServerActionResult> => {
    const locked = (await tx.execute(sql`select id, name, status from servers where id = ${serverId} for update`)).rows as { id: string; name: string; status: string }[];
    const server = locked[0];
    if (!server) return { code: 'not_found' };
    if (server.status === 'suspended') return { code: 'already_suspended' };
    await tx.update(servers).set({ status: 'suspended', statusReason: ctx.reason, updatedAt: new Date() }).where(eq(servers.id, serverId));
    await recordAudit({ actor: ctx.actor, action: 'server.suspend', targetType: 'server', targetId: serverId, targetLabel: server.name, reason: ctx.reason, requestId: ctx.requestId }, tx);
    return { code: 'ok' };
  });
  if (outcome.code !== 'ok') return outcome;
  await announce(serverId);
  // no access includes the calls: cut every member's media connection
  const voice = await db.select({ id: conversations.id }).from(conversations).where(and(eq(conversations.serverId, serverId), eq(conversations.type, 'voice')));
  for (const userId of await serverMemberIds(serverId)) for (const channel of voice) void revokeCallAccess(userId, channel.id);
  log.warn('server suspended', { actorId: ctx.actor.id, serverId, reason: ctx.reason });
  return { code: 'ok' };
}

export async function reactivateServer(ctx: Ctx, serverId: string): Promise<ServerActionResult> {
  const outcome = await db.transaction(async (tx): Promise<ServerActionResult> => {
    const locked = (await tx.execute(sql`select id, name, status from servers where id = ${serverId} for update`)).rows as { id: string; name: string; status: string }[];
    const server = locked[0];
    if (!server) return { code: 'not_found' };
    if (server.status !== 'suspended') return { code: 'not_suspended' };
    await tx.update(servers).set({ status: 'active', statusReason: '', updatedAt: new Date() }).where(eq(servers.id, serverId));
    await recordAudit({ actor: ctx.actor, action: 'server.reactivate', targetType: 'server', targetId: serverId, targetLabel: server.name, reason: ctx.reason, requestId: ctx.requestId }, tx);
    return { code: 'ok' };
  });
  if (outcome.code === 'ok') await announce(serverId);
  return outcome;
}

/** Recovery for an ownerless (or unwanted-owner) server: the chosen MEMBER
 * becomes its owner, under the server lock. The admin never becomes a member. */
export async function assignServerOwner(ctx: Ctx, serverId: string, newOwnerId: string): Promise<ServerActionResult> {
  const outcome = await db.transaction(async (tx): Promise<ServerActionResult> => {
    const locked = (await tx.execute(sql`select id, name, owner_id from servers where id = ${serverId} for update`)).rows as { id: string; name: string; owner_id: string | null }[];
    const server = locked[0];
    if (!server) return { code: 'not_found' };
    const [member] = await tx.select({ userId: serverMembers.userId }).from(serverMembers)
      .where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, newOwnerId))).limit(1);
    if (!member) return { code: 'not_member' };
    await tx.update(servers).set({ ownerId: newOwnerId, updatedAt: new Date() }).where(eq(servers.id, serverId));
    await recordAudit({
      actor: ctx.actor, action: 'server.assign_owner', targetType: 'server', targetId: serverId, targetLabel: server.name, reason: ctx.reason,
      detail: { newOwnerId, previousOwnerIds: server.owner_id ? [server.owner_id] : [] }, requestId: ctx.requestId,
    }, tx);
    return { code: 'ok' };
  });
  if (outcome.code !== 'ok') return outcome;
  await announce(serverId);
  log.warn('server owner assigned by an admin', { actorId: ctx.actor.id, serverId, newOwnerId });
  return { code: 'ok' };
}

export async function deleteServerAsAdmin(ctx: Ctx, serverId: string): Promise<ServerActionResult> {
  const [server] = await db.select({ name: servers.name }).from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server) return { code: 'not_found' };
  // audit first, in its own row: the server (and its files) are about to stop existing
  await recordAudit({ actor: ctx.actor, action: 'server.delete', targetType: 'server', targetId: serverId, targetLabel: server.name, reason: ctx.reason, requestId: ctx.requestId });
  try {
    const deleted = await deleteServerCompletely(serverId);
    if (!deleted) return { code: 'not_found' };
    log.warn('server deleted by an admin', { actorId: ctx.actor.id, serverId, members: deleted.memberIds.length });
  } catch (err) {
    await recordAuditFailure({ actor: ctx.actor, action: 'server.delete', targetType: 'server', targetId: serverId, targetLabel: server.name, reason: ctx.reason, requestId: ctx.requestId }, err);
    throw err;
  }
  return { code: 'ok' };
}

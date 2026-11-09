import crypto from 'node:crypto';
import { aliasedTable, and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { serverAuditLogs, users } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import type { Tx } from '../users/userPairLock.js';

// A server's own audit log: what its members with the power to change it did,
// shown in the server's settings to whoever holds VIEW_AUDIT_LOG. Separate from
// the instance trail (modules/admin/auditLog.ts): an instance admin acting on a
// server is recorded there, not here. A leaf module so every feature that
// changes a server can record without import cycles.

export const SERVER_AUDIT_ACTIONS = [
  'server.update', 'server.transfer',
  'member.kick', 'member.ban', 'member.unban', 'member.roles_update', 'member.voice_disconnect', 'member.voice_move',
  'role.create', 'role.update', 'role.delete', 'role.reorder',
  'channel.create', 'channel.update', 'channel.delete',
  'category.create', 'category.update', 'category.delete',
  'permissions.update',
  'invite.create', 'invite.revoke',
  'webhook.create', 'webhook.update', 'webhook.rotate', 'webhook.delete',
  'message.delete',
  'sound.create', 'sound.update', 'sound.delete',
  'emoji.create', 'emoji.update', 'emoji.delete',
  'sticker.create', 'sticker.update', 'sticker.delete',
] as const;

type ServerAuditAction = (typeof SERVER_AUDIT_ACTIONS)[number];
type ServerAuditTargetType = 'server' | 'user' | 'role' | 'channel' | 'category' | 'invite' | 'webhook' | 'message' | 'sound' | 'emoji' | 'sticker';

/** One field that changed. The client renders these generically, so a new
 * field needs a label there, not a new shape here. */
export interface AuditChange { key: string; before: unknown; after: unknown }

export interface ServerAuditEntry {
  serverId: string;
  actorId: string;
  action: ServerAuditAction;
  targetType: ServerAuditTargetType;
  targetId?: string;
  /** a user target's label is looked up when left out */
  targetLabel?: string;
  reason?: string;
  changes?: AuditChange[];
  /** context that is not a before/after: the channel a message was in, its author */
  extra?: Record<string, unknown>;
}

/** The fields of `keys` that differ between `before` and `after`. */
export function diffFields<T extends Record<string, unknown>>(before: T, after: Partial<T>, keys: readonly (keyof T & string)[]): AuditChange[] {
  return keys
    .filter((key) => after[key] !== undefined && after[key] !== before[key])
    .map((key) => ({ key, before: before[key], after: after[key] }));
}

/** What a new thing was created with, as changes from nothing; empty values
 * (no color, no permissions) are left out. */
export function createdFields(values: Record<string, unknown>): AuditChange[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 0)
    .map(([key, after]) => ({ key, before: null, after }));
}

/** What a removed thing had, as changes to nothing — the entry keeps what
 * the log would otherwise lose with the row. */
export function deletedFields(values: Record<string, unknown>): AuditChange[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== 0)
    .map(([key, before]) => ({ key, before, after: null }));
}

/** Pass the transaction of the change itself, so a change never exists
 * without its entry nor an entry without its change. Labels are snapshots
 * taken now: the log keeps naming a role or channel after it is renamed or
 * deleted. */
export async function recordServerAudit(executor: Tx, entry: ServerAuditEntry): Promise<void> {
  const lookup = [entry.actorId, ...(entry.targetType === 'user' && entry.targetId && entry.targetLabel === undefined ? [entry.targetId] : [])];
  const names = new Map((await executor.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, lookup))).map((u) => [u.id, u.username]));
  await executor.insert(serverAuditLogs).values({
    id: crypto.randomUUID(),
    serverId: entry.serverId,
    actorId: entry.actorId,
    actorLabel: names.get(entry.actorId) ?? '',
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? '',
    targetLabel: (entry.targetLabel ?? (entry.targetId ? names.get(entry.targetId) : undefined) ?? '').slice(0, 200),
    reason: (entry.reason ?? '').slice(0, 512),
    detail: { ...(entry.extra ?? {}), ...(entry.changes?.length ? { changes: entry.changes } : {}) },
  });
}

export interface ServerAuditFilters {
  action?: string;
  actorId?: string;
  targetId?: string;
  from?: string;
  to?: string;
}

export interface ServerAuditRow {
  id: string;
  at: string;
  action: string;
  actorId: string | null;
  actorLabel: string;
  /** the account as it is now; null once it is gone */
  actor: SocialUser | null;
  targetType: string;
  targetId: string;
  targetLabel: string;
  /** for a user target, the account as it is now */
  targetUser: SocialUser | null;
  reason: string;
  detail: Record<string, unknown>;
}

const createdAtIso = sql<string>`to_char(${serverAuditLogs.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const actorUsers = aliasedTable(users, 'actor_user');
const targetUsers = aliasedTable(users, 'target_user');

const isoDate = (raw: string | undefined): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Newest first, one page at a time. No access check: the route asks for
 * VIEW_AUDIT_LOG before calling this. */
export async function listServerAudit(serverId: string, filters: ServerAuditFilters, cursorRaw?: string): Promise<{ items: ServerAuditRow[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const from = isoDate(filters.from);
  const to = isoDate(filters.to);
  const t = serverAuditLogs;
  const rows = await db
    .select({ row: t, ts: createdAtIso, actor: actorUsers, target: targetUsers })
    .from(t)
    .leftJoin(actorUsers, eq(actorUsers.id, t.actorId))
    .leftJoin(targetUsers, and(eq(t.targetType, 'user'), eq(targetUsers.id, t.targetId)))
    .where(and(
      eq(t.serverId, serverId),
      filters.action ? eq(t.action, filters.action) : undefined,
      filters.actorId ? eq(t.actorId, filters.actorId) : undefined,
      filters.targetId ? eq(t.targetId, filters.targetId) : undefined,
      from ? sql`${t.createdAt} >= ${from.toISOString()}::timestamptz` : undefined,
      to ? sql`${t.createdAt} < ${to.toISOString()}::timestamptz` : undefined,
      cursor ? sql`(${t.createdAt}, ${t.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(t.createdAt), desc(t.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(({ row, ts, actor, target }) => ({
      id: row.id, at: ts, action: row.action,
      actorId: row.actorId, actorLabel: row.actorLabel, actor: actor ? toSocialUser(actor) : null,
      targetType: row.targetType, targetId: row.targetId, targetLabel: row.targetLabel, targetUser: target ? toSocialUser(target) : null,
      reason: row.reason, detail: row.detail,
    })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.row.id) : null,
  };
}

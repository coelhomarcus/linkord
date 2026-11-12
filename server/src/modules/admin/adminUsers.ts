import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { attachments, dataExports, messages, serverMembers, servers, users } from '../../db/schema.js';
import { destroyAllSessionsForUser, invalidateSessionsForUser } from '../auth/session.js';
import { broadcastToKnownPeers, listOnlineUserIds, participants, sendToUser } from '../presence/participants.js';
import { deleteAvatarFile } from '../attachments/attachmentCleanup.js';
import { deleteExportFiles } from '../data-export/exportStorage.js';
import { announceRevocations } from '../servers/serverInvitationsRepository.js';
import { revokePendingForUser } from '../servers/invitationRevocation.js';
import { invalidateServer } from '../servers/serverAccess.js';
import { broadcastToServerMembers, sendServerUpdateToMembers } from '../servers/serverSummaries.js';
import { deleteServerCompletely } from '../servers/serverDeletion.js';
import { countServerMembers } from '../servers/serversRepository.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { dropUserConnections } from './accountEnforcement.js';
import { decideAdminRoleChange, decideUserAction, pickSuccessor, type AdminRoleAction, type AdminRoleDecision, type UserActionDecision } from './adminPolicy.js';
import { listAudit, recordAudit, recordAuditFailure, type AuditActor } from './auditLog.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'admin' });

export type UserActionResult<T = object> = ({ code: 'ok' } & T) | { code: 'not_found' | 'forbidden' | 'confirmation_mismatch' | Exclude<UserActionDecision, 'allow'> };

export const CLI_ACTOR_ID = 'cli';

interface Ctx { actor: AuditActor; reason: string; requestId: string }
/** The account deletion the person asked for runs from a sweep, with no one acting: `actor` is null. */
interface PurgeCtx { actor: AuditActor | null; reason: string; requestId: string }

/** Locks every admin row (stable order) and then the target — so two admins
 * suspending/deleting each other, or the last two admins racing, serialize
 * and each sees the other's effect. */
async function lockAdminsAndTarget(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], targetId: string, actorId: string) {
  const admins = (await tx.execute(sql`select id, status from users where role = 'admin' order by id for update`)).rows as { id: string; status: string }[];
  const [target] = (await tx.execute(sql`
    select id, username, role, status, avatar, avatar_poster, banner, banner_poster, email, locale, deletion_due_at
    from users where id = ${targetId} for update`)).rows as unknown as LockedTarget[];
  // The actor was checked as an admin BEFORE this transaction; a concurrent
  // demotion or suspension may have landed since, so it is re-checked under the
  // lock. The CLI is not an account and is exempt.
  const actorStillAdmin = actorId === CLI_ACTOR_ID || admins.some((a) => a.id === actorId && a.status === 'active');
  return { activeAdminCount: admins.filter((a) => a.status === 'active').length, target, actorStillAdmin };
}

export async function suspendUser(ctx: Ctx, targetId: string): Promise<UserActionResult> {
  const outcome = await db.transaction(async (tx): Promise<UserActionResult<{ revokedInvitationIds: string[] }>> => {
    const { activeAdminCount, target, actorStillAdmin } = await lockAdminsAndTarget(tx, targetId, ctx.actor.id);
    if (!actorStillAdmin) return { code: 'forbidden' };
    if (!target) return { code: 'not_found' };
    const decision = decideUserAction({ action: 'suspend', actorId: ctx.actor.id, targetId, targetRole: target.role, targetStatus: target.status, activeAdminCount });
    if (decision !== 'allow') return { code: decision };
    await tx.update(users).set({ status: 'suspended', statusReason: ctx.reason, statusChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, targetId));
    const revokedInvitationIds = await revokePendingForUser(tx, targetId);
    await recordAudit({ actor: ctx.actor, action: 'user.suspend', targetType: 'user', targetId, targetLabel: target.username, reason: ctx.reason, requestId: ctx.requestId }, tx);
    return { code: 'ok', revokedInvitationIds };
  });
  if (outcome.code !== 'ok') return outcome;

  await destroyAllSessionsForUser(targetId);
  dropUserConnections(targetId);
  void announceRevocations(outcome.revokedInvitationIds);
  log.warn('account suspended', { actorId: ctx.actor.id, targetId, reason: ctx.reason });
  return { code: 'ok' };
}

export type AdminRoleResult = { code: 'ok' } | { code: 'not_found' | 'forbidden' | Exclude<AdminRoleDecision, 'allow'> };

/** Grants or removes the admin role — the ONLY way an admin comes to exist
 * (a username at sign-up is no longer enough). Same locks as suspend/delete,
 * so the last-admin protection holds under races; the trail is written in the
 * same transaction. */
export async function setAdminRole(ctx: Ctx, targetId: string, action: AdminRoleAction): Promise<AdminRoleResult> {
  const outcome = await db.transaction(async (tx): Promise<AdminRoleResult> => {
    const { activeAdminCount, target, actorStillAdmin } = await lockAdminsAndTarget(tx, targetId, ctx.actor.id);
    if (!actorStillAdmin) return { code: 'forbidden' };
    if (!target) return { code: 'not_found' };
    const decision = decideAdminRoleChange({ action, actorId: ctx.actor.id, targetId, targetRole: target.role, targetStatus: target.status, activeAdminCount });
    if (decision !== 'allow') return { code: decision };
    await tx.update(users).set({ role: action === 'grant' ? 'admin' : 'user', updatedAt: new Date() }).where(eq(users.id, targetId));
    await recordAudit({
      actor: ctx.actor, action: action === 'grant' ? 'user.grant_admin' : 'user.revoke_admin', targetType: 'user', targetId,
      targetLabel: target.username, reason: ctx.reason, requestId: ctx.requestId,
    }, tx);
    return { code: 'ok' };
  });
  if (outcome.code !== 'ok') return outcome;

  // the server always re-reads the role for admin decisions; this only keeps the
  // session cache and the live connections (and so the UI) in step
  const role = action === 'grant' ? 'admin' : 'user';
  invalidateSessionsForUser(targetId);
  for (const p of participants.values()) if (p.userId === targetId) p.role = role;
  sendToUser(targetId, { t: 'role-updated', role });
  log.warn(action === 'grant' ? 'admin role granted' : 'admin role removed', { actorId: ctx.actor.id, targetId });
  return { code: 'ok' };
}

export async function reactivateUser(ctx: Ctx, targetId: string): Promise<UserActionResult> {
  return db.transaction(async (tx): Promise<UserActionResult> => {
    const { activeAdminCount, target, actorStillAdmin } = await lockAdminsAndTarget(tx, targetId, ctx.actor.id);
    if (!actorStillAdmin) return { code: 'forbidden' };
    if (!target) return { code: 'not_found' };
    const decision = decideUserAction({ action: 'reactivate', actorId: ctx.actor.id, targetId, targetRole: target.role, targetStatus: target.status, activeAdminCount });
    if (decision !== 'allow') return { code: decision };
    await tx.update(users).set({ status: 'active', statusReason: '', statusChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, targetId));
    await recordAudit({ actor: ctx.actor, action: 'user.reactivate', targetType: 'user', targetId, targetLabel: target.username, reason: ctx.reason, requestId: ctx.requestId }, tx);
    log.info('account reactivated', { actorId: ctx.actor.id, targetId });
    return { code: 'ok' };
  });
}

/** Ends every session of the account without suspending it. */
export async function revokeUserSessions(ctx: Ctx, targetId: string): Promise<UserActionResult> {
  const [target] = await db.select({ username: users.username }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) return { code: 'not_found' };
  await destroyAllSessionsForUser(targetId);
  dropUserConnections(targetId);
  await recordAudit({ actor: ctx.actor, action: 'user.revoke_sessions', targetType: 'user', targetId, targetLabel: target.username, reason: ctx.reason, requestId: ctx.requestId });
  return { code: 'ok' };
}

interface LockedTarget {
  id: string; username: string; role: string; status: string;
  avatar: string; avatar_poster: string; banner: string; banner_poster: string;
  email: string | null; locale: string; deletion_due_at: Date | null;
}

type PurgeCheck = (locked: { target: LockedTarget; activeAdminCount: number; actorStillAdmin: boolean }) => UserActionResult['code'];

export interface PurgedAccount { username: string; email: string | null; locale: string; servers: number; successions: number }

/** Deletes an account (§7.4/§7.5), for an admin or for the deletion the person asked for
 * (auth/accountDeletion.ts). `check` decides, under the row locks, whether it may go on. Every server
 * the account OWNS first passes to the member who has been there longest — under the server row lock,
 * in the same transaction as the delete — so no server is ever left without an owner. A server with
 * nobody else left is emptied by the delete and removed right after (files included). */
export async function purgeUserAccount(ctx: PurgeCtx, targetId: string, check: PurgeCheck): Promise<UserActionResult<{ account: PurgedAccount }>> {
  const outcome = await db.transaction(async (tx): Promise<UserActionResult<{
    target: LockedTarget; serverIds: string[]; successions: { serverId: string; newOwnerId: string }[]; exportIds: string[];
  }>> => {
    const { activeAdminCount, target, actorStillAdmin } = await lockAdminsAndTarget(tx, targetId, ctx.actor?.id ?? CLI_ACTOR_ID);
    if (!target) return { code: 'not_found' };
    const decision = check({ target, activeAdminCount, actorStillAdmin });
    if (decision !== 'ok') return { code: decision };

    const memberships = await tx.select({ serverId: serverMembers.serverId }).from(serverMembers)
      .where(eq(serverMembers.userId, targetId)).orderBy(asc(serverMembers.serverId));

    const successions: { serverId: string; newOwnerId: string }[] = [];
    for (const m of memberships) {
      await tx.execute(sql`select id from servers where id = ${m.serverId} for update`);
      // the owner read under the lock — a concurrent transfer may already
      // have handed the server over
      const [server] = await tx.select({ ownerId: servers.ownerId }).from(servers).where(eq(servers.id, m.serverId)).limit(1);
      if (server?.ownerId !== targetId) continue;
      const members = await tx.select({ userId: serverMembers.userId, joinedAt: serverMembers.joinedAt })
        .from(serverMembers).where(eq(serverMembers.serverId, m.serverId));
      const successor = pickSuccessor(members, targetId);
      if (!successor) continue;
      await tx.update(servers).set({ ownerId: successor, updatedAt: new Date() }).where(eq(servers.id, m.serverId));
      successions.push({ serverId: m.serverId, newOwnerId: successor });
      await recordAudit({
        actor: ctx.actor, action: 'server.owner_succession', targetType: 'server', targetId: m.serverId,
        reason: `dono ${target.username} excluído`, detail: { newOwnerId: successor, previousOwnerId: targetId }, requestId: ctx.requestId,
      }, tx);
    }

    // the rows cascade with the account; their files are removed after the commit
    const exportIds = (await tx.select({ id: dataExports.id }).from(dataExports).where(eq(dataExports.userId, targetId))).map((r) => r.id);
    await tx.delete(users).where(eq(users.id, targetId));
    await recordAudit({
      actor: ctx.actor, action: 'user.delete', targetType: 'user', targetId, targetLabel: target.username, reason: ctx.reason,
      detail: { servers: memberships.length, successions: successions.length }, requestId: ctx.requestId,
    }, tx);
    return { code: 'ok', target, serverIds: memberships.map((m) => m.serverId), successions, exportIds };
  });
  if (outcome.code !== 'ok') return outcome;
  const { target } = outcome;

  // the sessions cascaded away with the row; live connections still need cutting
  await destroyAllSessionsForUser(targetId);
  dropUserConnections(targetId);
  broadcastToKnownPeers(targetId, { t: 'user-deleted', userId: targetId });

  // the membership cascaded with the account: a server left with nobody is
  // gone for good, the others just lose a member
  for (const serverId of outcome.serverIds) {
    invalidateServer(serverId);
    if ((await countServerMembers(serverId)) === 0) {
      await deleteServerCompletely(serverId);
      continue;
    }
    await sendServerUpdateToMembers(serverId);
    await broadcastToServerMembers(serverId, { t: 'server-member-removed', serverId, userId: targetId });
  }
  log.warn('account deleted', { actorId: ctx.actor?.id ?? null, targetId, servers: outcome.serverIds.length, successions: outcome.successions.length });

  for (const image of [target.avatar, target.avatar_poster, target.banner, target.banner_poster]) {
    if (!image) continue;
    await deleteAvatarFile(image).catch((err) => recordAuditFailure(
      { actor: ctx.actor, action: 'user.delete.avatar_cleanup', targetType: 'user', targetId, targetLabel: target.username, requestId: ctx.requestId }, err,
    ));
  }
  await deleteExportFiles(outcome.exportIds).catch((err) => recordAuditFailure(
    { actor: ctx.actor, action: 'user.delete.export_cleanup', targetType: 'user', targetId, targetLabel: target.username, requestId: ctx.requestId }, err,
  ));
  return {
    code: 'ok',
    account: { username: target.username, email: target.email, locale: target.locale, servers: outcome.serverIds.length, successions: outcome.successions.length },
  };
}

/** An admin deleting someone else's account, confirmed by typing its username. */
export async function deleteUserAccount(ctx: Ctx, targetId: string, confirm: string): Promise<UserActionResult> {
  const [known] = await db.select({ username: users.username }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!known) return { code: 'not_found' };
  if (confirm.trim().toLowerCase() !== known.username.toLowerCase()) return { code: 'confirmation_mismatch' };
  const result = await purgeUserAccount(ctx, targetId, ({ target, activeAdminCount, actorStillAdmin }) => {
    if (!actorStillAdmin) return 'forbidden';
    const decision = decideUserAction({ action: 'delete', actorId: ctx.actor?.id ?? CLI_ACTOR_ID, targetId, targetRole: target.role, targetStatus: target.status, activeAdminCount });
    return decision === 'allow' ? 'ok' : decision;
  });
  return result.code === 'ok' ? { code: 'ok' } : result;
}

// ---- reads -------------------------------------------------------------------

const createdAtIso = sql<string>`to_char(${users.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface AdminUserRow {
  id: string; username: string; displayName: string; avatar: string; avatarColor: string;
  role: string; status: string; createdAt: string;
  lastSeenAt: string | null;
  online: boolean;
}

export interface AdminUserFilters { q?: string; status?: string; role?: string; from?: string; to?: string }

const isoDate = (raw: string | undefined): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function listAdminUsers(filters: AdminUserFilters, cursorRaw?: string): Promise<{ items: AdminUserRow[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const q = filters.q?.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const from = isoDate(filters.from);
  const to = isoDate(filters.to);
  const rows = await db
    .select({ user: users, ts: createdAtIso })
    .from(users)
    .where(and(
      // the exact id uses the raw text: ids are case-sensitive and `q` was lowered and escaped for LIKE
      q ? sql`(lower(${users.username}) like ${`%${q}%`} or lower(${users.displayName}) like ${`%${q}%`} or ${users.id} = ${filters.q?.trim() ?? ''})` : undefined,
      filters.status === 'active' || filters.status === 'suspended' ? eq(users.status, filters.status) : undefined,
      filters.role === 'admin' || filters.role === 'user' ? eq(users.role, filters.role) : undefined,
      from ? sql`${users.createdAt} >= ${from.toISOString()}::timestamptz` : undefined,
      to ? sql`${users.createdAt} < ${to.toISOString()}::timestamptz` : undefined,
      cursor ? sql`(${users.createdAt}, ${users.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  const onlineIds = new Set(listOnlineUserIds());
  return {
    items: page.map(({ user: u, ts }) => ({
      id: u.id, username: u.username, displayName: u.displayName.trim() || u.username, avatar: u.avatar, avatarColor: u.avatarColor,
      role: u.role, status: u.status, createdAt: ts,
      lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
      online: onlineIds.has(u.id),
    })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.user.id) : null,
  };
}

/** Operational detail for one account. E-mail appears here only — never the
 * password hash, sessions or tokens — and reading it is not a privileged
 * social action, so it is not audited (evidence access is; see reports). */
export async function getAdminUser(userId: string) {
  const [row] = await db.select({ user: users, ts: createdAtIso }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  const u = row.user;
  const serverRows = await db
    .select({ id: servers.id, name: servers.name, status: servers.status, ownerId: servers.ownerId })
    .from(serverMembers)
    .innerJoin(servers, eq(servers.id, serverMembers.serverId))
    .where(eq(serverMembers.userId, userId))
    .orderBy(asc(servers.name));
  const memberServers = serverRows.map((r) => ({ id: r.id, name: r.name, status: r.status, isOwner: r.ownerId === userId }));
  // bytes attributable to the account: attachments on messages it authored
  const [usage] = await db
    .select({ bytes: sql<number>`coalesce(sum(${attachments.size}), 0)::float8`, files: sql<number>`count(${attachments.id})::int` })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(and(eq(messages.authorId, userId), eq(attachments.isThumbnail, false)));
  const history = await listAudit({ targetType: 'user', targetId: userId });
  return {
    user: {
      id: u.id, username: u.username, displayName: u.displayName.trim() || u.username, email: u.email, avatar: u.avatar, avatarColor: u.avatarColor,
      role: u.role, status: u.status, statusReason: u.statusReason,
      statusChangedAt: u.statusChangedAt ? u.statusChangedAt.toISOString() : null, createdAt: row.ts,
      lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
      online: listOnlineUserIds().includes(u.id),
    },
    servers: memberServers,
    storage: { bytes: usage?.bytes ?? 0, files: usage?.files ?? 0 },
    history: history === 'invalid_cursor' ? [] : history.items,
  };
}

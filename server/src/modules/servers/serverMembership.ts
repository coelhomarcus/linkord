import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, serverBans, serverMembers, servers } from '../../db/schema.js';
import { participants } from '../presence/participants.js';
import { refreshKnownPeers } from '../presence/knownPeers.js';
import { revokeCallAccess } from '../calls/callAccess.js';
import { enforceCallPermissions } from '../calls/callPermissions.js';
import { hasPermission, outranks, PERMISSIONS, computeBasePermissions } from './permissions.js';
import { invalidateServer, loadServerSnapshot, memberInput } from './serverAccess.js';
import { lockServer, serverMemberIds } from './serversRepository.js';
import { broadcastToServerMembers, sendServerRemoved, sendServerUpdateToMembers } from './serverSummaries.js';
import { deleteServerCompletely } from './serverDeletion.js';
import { recordServerAudit } from './serverAuditLog.js';

export type RemovalDecision = 'allow' | 'forbidden' | 'owner_must_transfer' | 'not_member';

/** Who may take a member out of a server: anyone may leave (the owner only
 * once alone — otherwise the server would be left without one); removing
 * someone else takes the right permission AND a higher place in the role
 * hierarchy than theirs. */
export function decideRemoval(input: {
  actorIsMember: boolean; targetIsMember: boolean; isSelf: boolean; targetIsOwner: boolean;
  actorHasPermission: boolean; actorOutranksTarget: boolean; memberCount: number;
}): RemovalDecision {
  if (!input.targetIsMember) return 'not_member';
  if (!input.actorIsMember) return 'forbidden';
  if (input.isSelf) return input.targetIsOwner && input.memberCount > 1 ? 'owner_must_transfer' : 'allow';
  return input.actorHasPermission && input.actorOutranksTarget ? 'allow' : 'forbidden';
}

export type TransferDecision = 'allow' | 'forbidden' | 'not_member';

/** Ownership only moves from the current owner to another member. */
export function decideTransfer(input: { actorIsOwner: boolean; targetIsMember: boolean; isSelf: boolean }): TransferDecision {
  if (!input.actorIsOwner || input.isSelf) return 'forbidden';
  return input.targetIsMember ? 'allow' : 'not_member';
}

export type RemoveMemberResult =
  | { code: 'ok'; serverDeleted: boolean }
  | { code: 'not_found' | 'not_member' | 'forbidden' | 'owner_must_transfer' };

type RemovalKind = 'leave' | 'kick' | 'ban';

async function cutCallsInServer(userId: string, serverId: string): Promise<void> {
  const channelIds = new Set((await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.serverId, serverId))).map((r) => r.id));
  const calls = new Set<string>();
  for (const p of participants.values()) {
    if (p.userId === userId && p.callConversationId && channelIds.has(p.callConversationId)) calls.add(p.callConversationId);
  }
  for (const id of calls) void revokeCallAccess(userId, id);
}

/** Leaving, kicking and banning share one path, validated and applied under
 * the server row lock so a concurrent transfer or role change sees either
 * the state before or after. The last member leaving deletes the server —
 * nobody could ever reach a memberless one again. */
export async function removeMember(serverId: string, actorId: string, targetId: string, kind: RemovalKind, reason = ''): Promise<RemoveMemberResult> {
  const outcome = await db.transaction(async (tx): Promise<{ code: 'ok'; remaining: number } | Exclude<RemoveMemberResult, { code: 'ok' }>> => {
    const locked = await lockServer(tx, serverId);
    if (locked.rows.length === 0) return { code: 'not_found' };
    invalidateServer(serverId);
    const snapshot = await loadServerSnapshot(serverId);
    if (!snapshot || snapshot.server.status !== 'active') return { code: 'not_found' };
    const actor = memberInput(snapshot, actorId);
    const target = memberInput(snapshot, targetId);
    const permission = kind === 'ban' ? PERMISSIONS.BAN_MEMBERS : PERMISSIONS.KICK_MEMBERS;
    const decision = decideRemoval({
      actorIsMember: !!actor, targetIsMember: !!target, isSelf: actorId === targetId, targetIsOwner: !!target?.isOwner,
      actorHasPermission: !!actor && hasPermission(computeBasePermissions(actor, snapshot.roles), permission),
      actorOutranksTarget: !!actor && !!target && outranks(actor, target, snapshot.roles),
      memberCount: snapshot.members.size,
    });
    // a ban is never a way to leave
    if (decision !== 'allow' || (kind !== 'leave' && actorId === targetId)) return { code: decision === 'allow' ? 'forbidden' : decision };

    await tx.delete(serverMembers).where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, targetId)));
    if (kind === 'ban') {
      await tx.insert(serverBans).values({ serverId, userId: targetId, bannedBy: actorId, reason: reason.slice(0, 512) }).onConflictDoNothing();
    }
    if (kind !== 'leave') {
      await recordServerAudit(tx, { serverId, actorId, action: kind === 'ban' ? 'member.ban' : 'member.kick', targetType: 'user', targetId, reason: kind === 'ban' ? reason : '' });
    }
    return { code: 'ok', remaining: snapshot.members.size - 1 };
  });
  invalidateServer(serverId);
  if (outcome.code !== 'ok') return outcome;

  sendServerRemoved(targetId, serverId, kind === 'leave' ? undefined : kind === 'ban' ? 'banned' : 'removed');
  await cutCallsInServer(targetId, serverId);
  if (outcome.remaining === 0) {
    await deleteServerCompletely(serverId);
    return { code: 'ok', serverDeleted: true };
  }
  await sendServerUpdateToMembers(serverId);
  await broadcastToServerMembers(serverId, { t: 'server-member-removed', serverId, userId: targetId });
  await refreshKnownPeers([targetId, ...(await serverMemberIds(serverId))]);
  return { code: 'ok', serverDeleted: false };
}

export type TransferResult = { code: 'ok' } | { code: 'not_found' | 'forbidden' | 'not_member' };

/** Validates AND swaps under the server row lock — checking before taking
 * the lock would let a concurrent removal of the new owner slip in between
 * and leave the server owned by someone no longer in it. */
export async function transferOwnership(serverId: string, actorId: string, newOwnerId: string): Promise<TransferResult> {
  const result = await db.transaction(async (tx): Promise<TransferResult> => {
    const locked = await lockServer(tx, serverId);
    if (locked.rows.length === 0) return { code: 'not_found' };
    const [server] = await tx.select({ ownerId: servers.ownerId, status: servers.status }).from(servers).where(eq(servers.id, serverId)).limit(1);
    const [target] = await tx.select({ userId: serverMembers.userId }).from(serverMembers)
      .where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, newOwnerId))).limit(1);
    if (!server || server.status !== 'active') return { code: 'not_found' };
    const decision = decideTransfer({ actorIsOwner: server.ownerId === actorId, targetIsMember: !!target, isSelf: actorId === newOwnerId });
    if (decision !== 'allow') return { code: decision };
    await tx.update(servers).set({ ownerId: newOwnerId, updatedAt: new Date() }).where(eq(servers.id, serverId));
    await recordServerAudit(tx, { serverId, actorId, action: 'server.transfer', targetType: 'user', targetId: newOwnerId });
    return { code: 'ok' };
  });
  invalidateServer(serverId);
  if (result.code === 'ok') {
    await sendServerUpdateToMembers(serverId);
    // the previous owner keeps only what their roles give
    void enforceCallPermissions(serverId);
  }
  return result;
}

export async function unbanMember(serverId: string, actorId: string, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const deleted = await tx.delete(serverBans).where(and(eq(serverBans.serverId, serverId), eq(serverBans.userId, userId))).returning();
    if (!deleted.length) return false;
    await recordServerAudit(tx, { serverId, actorId, action: 'member.unban', targetType: 'user', targetId: userId });
    return true;
  });
}

/** The member's own rail order: `serverIds` in the order they want them. Ids
 * of servers they are not in are ignored; ones left out keep their place
 * after the listed ones. */
export async function reorderServersForUser(userId: string, serverIds: string[]): Promise<void> {
  const rows = await db.select({ serverId: serverMembers.serverId, position: serverMembers.position }).from(serverMembers)
    .where(eq(serverMembers.userId, userId));
  const known = new Set(rows.map((r) => r.serverId));
  const ordered = [...new Set(serverIds.filter((id) => known.has(id)))];
  const rest = rows.filter((r) => !ordered.includes(r.serverId)).sort((a, b) => a.position - b.position).map((r) => r.serverId);
  const final = [...ordered, ...rest];
  await db.transaction(async (tx) => {
    for (const [position, serverId] of final.entries()) {
      await tx.update(serverMembers).set({ position }).where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, userId)));
    }
  });
  for (const serverId of final) invalidateServer(serverId);
}

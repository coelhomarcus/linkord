import crypto from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  messages, notifications, outboxEvents, serverInvitations, servers, users,
  type Conversation, type Message, type Server, type ServerInvitation, type User,
} from '../../db/schema.js';
import { withUserPairLock, type Tx } from '../users/userPairLock.js';
import { findById, resolveDisplayName, toSocialUser, type SocialUser } from '../users/users.js';
import { getFriendship } from '../friendships/friendshipsRepository.js';
import { isBlockedEitherWay } from '../blocks/blocksRepository.js';
import { markNotificationsRead } from '../notifications/notificationsRepository.js';
import { countServerMemberships, exceedsLimit, limitMax } from '../limits/limits.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor, escapeLike } from '../friendships/cursor.js';
import { notifySocialChanged, onSocialChange, refreshKnownPeers } from '../presence/knownPeers.js';
import { broadcastToConversationMembers, getOrCreateDirect, touchConversation } from '../conversations/conversationsRepository.js';
import { loadInvitationCards, type InvitationCard } from './invitationCards.js';
import { hasPermission, PERMISSIONS } from './permissions.js';
import { invalidateServer, serverPermissions } from './serverAccess.js';
import { addServerMember, countServerMembers, isBanned, isServerMember, lockServer, serverMemberIds } from './serversRepository.js';
import { broadcastToServerMembers, sendServerUpdateToMembers } from './serverSummaries.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'invitations' });

// Inviting friends to a server (docs/plano-rede-social.md §5.5, §5.6, §6.2,
// §7.2) — a card in their DM. An invitation is NOT membership: the only
// thing here that creates a member is acceptInvitation. Invite LINKS are
// serverInvites.ts.
//
// LOCK ORDER — one order for every operation here, so none can deadlock:
//   1. the user-pair advisory lock (the same one friendships/blocks take)
//   2. the server row  (`for update`)
//   3. the invitation row  (`for update`)
// Accept reads the invitation UNLOCKED first, only to learn the pair and the
// server.

export type InviteOutcome = 'sent' | 'already_pending' | 'already_member' | 'not_friends' | 'server_full' | 'banned' | 'unavailable';
export interface InviteResult { userId: string; outcome: InviteOutcome; invitationId?: string }

// distributes over the union so `code` stays a real discriminant
type Code<T extends string> = T extends string ? { code: T } : never;

export type InvitationAction =
  | { code: 'ok'; card: InvitationCard }
  | Code<'not_found' | 'forbidden' | 'invalid_state' | 'server_full' | 'banned' | 'quota_exceeded'>;

// ---- pure helpers (unit-tested) ---------------------------------------------

/** Deduplicates, drops non-strings and the inviter themself, and reports a
 * batch over the server-fixed cap instead of silently truncating it. */
export function normalizeInviteeIds(raw: unknown, inviterId: string): { ids: string[]; tooMany: boolean } {
  const list = Array.isArray(raw) ? raw : [];
  const ids = [...new Set(list.filter((v): v is string => typeof v === 'string' && v.length > 0 && v !== inviterId))];
  return { ids, tooMany: ids.length > config.MAX_INVITEES_PER_REQUEST };
}

// ---- locks ------------------------------------------------------------------

const lockInvitation = (tx: Tx, id: string) => tx.execute(sql`select id from server_invitations where id = ${id} for update`);

// ---- events -----------------------------------------------------------------

/** The card as a chat message. Built here (not through messages.ts) because
 * messages.ts consumes this module's leaf pieces — importing it back would
 * make a cycle; the shape is the same one `rowToMessage` produces. */
function cardMessagePayload(message: Message, inviter: User, card: InvitationCard | null) {
  return {
    msgId: message.id, conversationId: message.conversationId, id: inviter.id,
    name: resolveDisplayName(inviter.displayName, inviter.username), avatar: inviter.avatar,
    text: '', ts: message.createdAt.getTime(), kind: 'server_invite' as const, invitation: card,
  };
}

/** Pushes the current state of these invitations to whoever is looking at
 * their card — the two members of the DM the card lives in. Never throws: it
 * runs after the change committed. */
export async function broadcastInvitationUpdates(invitationIds: string[]): Promise<void> {
  if (!invitationIds.length) return;
  try {
    const [cards, cardMessages] = await Promise.all([
      loadInvitationCards(invitationIds),
      db.select({ invitationId: messages.serverInvitationId, conversationId: messages.conversationId })
        .from(messages).where(inArray(messages.serverInvitationId, invitationIds)),
    ]);
    for (const row of cardMessages) {
      const card = row.invitationId ? cards.get(row.invitationId) : undefined;
      if (card) await broadcastToConversationMembers(row.conversationId, { t: 'invitation-updated', invitation: card });
    }
  } catch (err) {
    log.error('failed to broadcast card updates', err);
  }
}

async function recordInvitationEvent(tx: Tx, invitation: ServerInvitation): Promise<void> {
  await tx.insert(notifications).values({
    id: crypto.randomUUID(), recipientId: invitation.inviteeId, kind: 'server_invitation',
    serverInvitationId: invitation.id, dedupeKey: `server_invitation:${invitation.id}:${invitation.version}`,
  }).onConflictDoNothing();
  await tx.insert(outboxEvents).values({
    id: crypto.randomUUID(), type: 'server_invitation_created', audienceUserId: invitation.inviteeId,
    payload: { invitationId: invitation.id },
  });
}

// ---- create -----------------------------------------------------------------

interface SentCard { invitation: ServerInvitation; message: Message; dm: Conversation }

/** Whoever may invite: a member holding CREATE_INVITE in an active server. */
async function canInvite(serverId: string, userId: string): Promise<boolean> {
  return hasPermission(await serverPermissions(serverId, userId), PERMISSIONS.CREATE_INVITE);
}

/** One invitee, in its own transaction — a failure for one person never takes
 * the rest of the batch down (per-recipient results, §5.5). */
async function inviteOne(inviterId: string, serverId: string, inviteeId: string): Promise<{ result: InviteResult; sent?: SentCard }> {
  const unavailable: InviteResult = { userId: inviteeId, outcome: 'unavailable' };
  if (!(await findById(inviteeId))) return { result: unavailable };
  try {
    return await withUserPairLock(inviterId, inviteeId, async (tx) => {
      await lockServer(tx, serverId);
      const [server] = await tx.select().from(servers).where(eq(servers.id, serverId)).limit(1);
      if (!server || server.status !== 'active') return { result: unavailable };
      // authority is re-checked INSIDE the lock — the caller may have lost
      // the permission between the up-front check and here
      if (!(await canInvite(serverId, inviterId))) return { result: unavailable };

      // "not friends" and "blocked" read the same to the caller (§5.4)
      const friendship = await getFriendship(inviterId, inviteeId, tx);
      if (friendship?.status !== 'accepted' || (await isBlockedEitherWay(inviterId, inviteeId, tx))) {
        return { result: { userId: inviteeId, outcome: 'not_friends' } };
      }
      if (await isServerMember(serverId, inviteeId, tx)) return { result: { userId: inviteeId, outcome: 'already_member' } };
      if (await isBanned(serverId, inviteeId, tx)) return { result: { userId: inviteeId, outcome: 'banned' } };
      if ((await countServerMembers(serverId, tx)) >= config.MAX_SERVER_MEMBERS) return { result: { userId: inviteeId, outcome: 'server_full' } };

      // a declined, revoked or legacy-expired invite can be sent again right
      // away; only a still-pending one blocks (the partial unique index agrees)
      const [pending] = await tx.select({ id: serverInvitations.id }).from(serverInvitations)
        .where(and(eq(serverInvitations.serverId, serverId), eq(serverInvitations.inviteeId, inviteeId), eq(serverInvitations.status, 'pending')))
        .limit(1);
      if (pending) return { result: { userId: inviteeId, outcome: 'already_pending', invitationId: pending.id } };

      const [invitation] = await tx.insert(serverInvitations).values({
        id: crypto.randomUUID(), serverId, inviterId, inviteeId,
      }).returning();
      await recordInvitationEvent(tx, invitation!);

      const { conversation: dm } = await getOrCreateDirect(inviterId, inviteeId, inviterId, tx);
      const [message] = await tx.insert(messages).values({
        conversationId: dm.id, authorId: inviterId, text: '', kind: 'server_invite', serverInvitationId: invitation!.id,
      }).returning();
      return {
        result: { userId: inviteeId, outcome: 'sent', invitationId: invitation!.id },
        sent: { invitation: invitation!, message: message!, dm },
      };
    });
  } catch (err) {
    log.error('failed to invite', err, { inviteeId });
    return { result: unavailable };
  }
}

/** Everything that happens AFTER one card committed: the DM starts showing
 * for the invitee (touchConversation → conversation-updated, which their
 * client now inserts), the card arrives as a chat message, and both accounts
 * refetch their social lists. */
async function announceCard(inviter: User, sent: SentCard): Promise<void> {
  try {
    const card = (await loadInvitationCards([sent.invitation.id])).get(sent.invitation.id) ?? null;
    await touchConversation(sent.dm.id, sent.message.createdAt);
    await broadcastToConversationMembers(sent.dm.id, { t: 'chat', message: cardMessagePayload(sent.message, inviter, card) });
    await onSocialChange(inviter.id, sent.invitation.inviteeId);
  } catch (err) {
    log.error('failed to announce a card', err);
  }
}

/** Invites friends of a member who may create invites. Validates authority
 * once up front, then issues each invitation independently. */
export async function createInvitations(
  inviterId: string, serverId: string, rawInviteeIds: unknown,
): Promise<{ results: InviteResult[] } | { error: 'not_found' | 'forbidden' | 'too_many' }> {
  const [server] = await db.select({ status: servers.status }).from(servers).where(eq(servers.id, serverId)).limit(1);
  if (!server || server.status !== 'active' || !(await isServerMember(serverId, inviterId))) return { error: 'not_found' };
  if (!(await canInvite(serverId, inviterId))) return { error: 'forbidden' };
  const { ids, tooMany } = normalizeInviteeIds(rawInviteeIds, inviterId);
  if (tooMany) return { error: 'too_many' };

  const inviter = await findById(inviterId);
  if (!inviter) return { error: 'forbidden' };
  const results: InviteResult[] = [];
  for (const inviteeId of ids) {
    const { result, sent } = await inviteOne(inviterId, serverId, inviteeId);
    results.push(result);
    if (sent) await announceCard(inviter, sent);
  }
  return { results };
}

// ---- respond ----------------------------------------------------------------

async function cardOf(id: string): Promise<InvitationCard | null> {
  return (await loadInvitationCards([id])).get(id) ?? null;
}

/** Shared skeleton of accept/decline/revoke: read the invitation unlocked
 * (only to learn the pair and the server), then take the locks in the global
 * order and re-read it under the lock. */
async function withInvitationLocks<T>(
  id: string,
  authorize: (pre: ServerInvitation) => boolean,
  body: (tx: Tx, invitation: ServerInvitation, server: Server) => Promise<T>,
): Promise<T | Code<'not_found'>> {
  const [pre] = await db.select().from(serverInvitations).where(eq(serverInvitations.id, id)).limit(1);
  if (!pre || !authorize(pre)) return { code: 'not_found' };
  return withUserPairLock(pre.inviterId, pre.inviteeId, async (tx) => {
    await lockServer(tx, pre.serverId);
    await lockInvitation(tx, id);
    const [invitation] = await tx.select().from(serverInvitations).where(eq(serverInvitations.id, id)).limit(1);
    const [server] = await tx.select().from(servers).where(eq(servers.id, pre.serverId)).limit(1);
    // the server (and with it the invitation) can be deleted between the
    // unlocked read and the locks
    if (!invitation || !server) return { code: 'not_found' as const };
    return body(tx, invitation, server);
  });
}

const markStatus = async (tx: Tx, id: string, status: 'accepted' | 'declined' | 'revoked') => {
  await tx.update(serverInvitations)
    .set({ status, respondedAt: new Date(), version: sql`${serverInvitations.version} + 1` })
    .where(eq(serverInvitations.id, id));
  await markNotificationsRead(tx, { invitationIds: [id] });
};

/** Everything that follows a new member joining, whichever way they came
 * in (an invitation or a link): their client gets the server, everyone
 * else's member list and counts update, and presence learns the new peers. */
export async function announceNewMember(serverId: string, userId: string): Promise<void> {
  invalidateServer(serverId);
  await sendServerUpdateToMembers(serverId, 'server-created', [userId]);
  await sendServerUpdateToMembers(serverId);
  await broadcastToServerMembers(serverId, { t: 'server-member-added', serverId, userId });
  await refreshKnownPeers(await serverMemberIds(serverId));
}

/** The one invitation path that creates a member. Re-validates EVERYTHING
 * under the locks — validity, the inviter's authority, friendship, blocks,
 * bans, existing membership, capacity — because any of it can have changed
 * since the card was sent. Idempotent: a second tab accepting just gets the
 * current state. */
export async function acceptInvitation(inviteeId: string, id: string): Promise<InvitationAction> {
  let joined: string | null = null;
  let revokedFor: string | null = null;

  const outcome = await withInvitationLocks<Code<'ok' | 'invalid_state' | 'server_full' | 'banned' | 'quota_exceeded'>>(
    id,
    (pre) => pre.inviteeId === inviteeId,
    async (tx, invitation, server) => {
      const alreadyMember = await isServerMember(server.id, inviteeId, tx);
      if (invitation.status === 'accepted') return { code: 'ok' as const };
      if (invitation.status !== 'pending') return { code: 'invalid_state' as const };

      const friendship = await getFriendship(invitation.inviterId, inviteeId, tx);
      const stillAllowed = server.status === 'active' && (await canInvite(server.id, invitation.inviterId))
        && friendship?.status === 'accepted' && !(await isBlockedEitherWay(invitation.inviterId, inviteeId, tx));
      if (!stillAllowed) {
        // never leave a pending invitation that can no longer be honored
        await markStatus(tx, id, 'revoked');
        revokedFor = invitation.inviterId;
        return { code: 'invalid_state' as const };
      }
      if (!alreadyMember) {
        if (await isBanned(server.id, inviteeId, tx)) return { code: 'banned' as const };
        if ((await countServerMembers(server.id, tx)) >= config.MAX_SERVER_MEMBERS) return { code: 'server_full' as const };
        // the invitee's OWN limit on how many servers they can belong to
        if (exceedsLimit(await countServerMemberships(inviteeId, tx), limitMax('serverMemberships'))) return { code: 'quota_exceeded' as const };
        await addServerMember(tx, server.id, inviteeId);
        joined = server.id;
      }
      await markStatus(tx, id, 'accepted');
      return { code: 'ok' as const };
    },
  );

  const [pre] = await db.select({ inviterId: serverInvitations.inviterId }).from(serverInvitations).where(eq(serverInvitations.id, id)).limit(1);
  if (revokedFor) {
    await broadcastInvitationUpdates([id]);
    notifySocialChanged([revokedFor, inviteeId]);
  } else if (outcome.code === 'ok') {
    if (joined) await announceNewMember(joined, inviteeId);
    await broadcastInvitationUpdates([id]);
    if (pre) notifySocialChanged([pre.inviterId, inviteeId]);
  }
  if (outcome.code === 'ok') {
    const card = await cardOf(id);
    return card ? { code: 'ok', card } : { code: 'not_found' };
  }
  return outcome;
}

/** The recipient turns it down. Deliberately NOT announced to the inviter as
 * a rejection (§5.3) — the card just shows the new state. */
export async function declineInvitation(inviteeId: string, id: string): Promise<InvitationAction> {
  let changed = false;
  let inviterId = '';
  const outcome = await withInvitationLocks<Code<'ok' | 'invalid_state'>>(
    id,
    (pre) => pre.inviteeId === inviteeId,
    async (tx, invitation) => {
      inviterId = invitation.inviterId;
      if (invitation.status === 'declined') return { code: 'ok' as const };
      if (invitation.status !== 'pending') return { code: 'invalid_state' as const };
      await markStatus(tx, id, 'declined');
      changed = true;
      return { code: 'ok' as const };
    },
  );
  if (changed) {
    await broadcastInvitationUpdates([id]);
    notifySocialChanged([inviterId, inviteeId]);
  }
  if (outcome.code === 'ok') {
    const card = await cardOf(id);
    return card ? { code: 'ok', card } : { code: 'not_found' };
  }
  return outcome;
}

/** Whoever sent it, or anyone who manages the server, takes it back. */
export async function revokeInvitation(actorId: string, id: string): Promise<InvitationAction> {
  let changed = false;
  let inviteeId = '';
  const outcome = await withInvitationLocks<Code<'ok' | 'forbidden' | 'invalid_state'>>(
    id,
    () => true,
    async (tx, invitation, server) => {
      inviteeId = invitation.inviteeId;
      const manages = hasPermission(await serverPermissions(server.id, actorId), PERMISSIONS.MANAGE_SERVER);
      if (invitation.inviterId !== actorId && !manages) return { code: 'forbidden' as const };
      if (invitation.status === 'revoked') return { code: 'ok' as const };
      if (invitation.status !== 'pending') return { code: 'invalid_state' as const };
      await markStatus(tx, id, 'revoked');
      changed = true;
      return { code: 'ok' as const };
    },
  );
  if (changed) {
    await broadcastInvitationUpdates([id]);
    notifySocialChanged([actorId, inviteeId]);
  }
  if (outcome.code === 'ok') {
    const card = await cardOf(id);
    return card ? { code: 'ok', card } : { code: 'not_found' };
  }
  return outcome;
}

/** Deleting the card message takes the invitation back, so the chat and the
 * invitation can never disagree about whether the person may still join. Only a
 * PENDING invitation is affected: someone who already accepted stays a member.
 * The card itself is not broadcast — its message is about to be deleted. */
export async function revokeInvitationForDeletedCard(id: string): Promise<void> {
  let parties: [string, string] | null = null;
  await withInvitationLocks<Code<'ok'>>(id, () => true, async (tx, invitation) => {
    if (invitation.status !== 'pending') return { code: 'ok' as const };
    await markStatus(tx, id, 'revoked');
    parties = [invitation.inviterId, invitation.inviteeId];
    return { code: 'ok' as const };
  });
  if (parties) notifySocialChanged(parties);
}

/** Pushes the card update and the list-refresh signal for ids that were
 * revoked inside someone else's transaction (block, unfriend, ownership
 * transfer) — those callers get the ids back from invitationRevocation.ts. */
export async function announceRevocations(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await broadcastInvitationUpdates(ids);
  const rows = await db.select({ inviterId: serverInvitations.inviterId, inviteeId: serverInvitations.inviteeId })
    .from(serverInvitations).where(inArray(serverInvitations.id, ids));
  for (const r of rows) notifySocialChanged([r.inviterId, r.inviteeId]);
}

// ---- lists ------------------------------------------------------------------

const microsecondIso = sql<string>`to_char(${serverInvitations.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface ReceivedInvitationEntry {
  id: string;
  at: string;
  server: { id: string; name: string; icon: string; memberCount: number };
  inviter: SocialUser;
}

export interface SentInvitationEntry { id: string; at: string; invitee: SocialUser; inviter: SocialUser }

/** The caller's pending invitations, newest first. `q` matches the server's name or the
 * inviter's name/username — only among invitations this account already has. */
export async function listReceivedInvitations(userId: string, cursorRaw?: string, q?: string): Promise<{ items: ReceivedInvitationEntry[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const rows = await db
    .select({
      id: serverInvitations.id, ts: microsecondIso,
      serverId: servers.id, serverName: servers.name, serverIcon: servers.icon,
      memberCount: sql<number>`(select count(*)::int from server_members m where m.server_id = ${servers.id})`,
      inviter: users,
    })
    .from(serverInvitations)
    .innerJoin(servers, eq(servers.id, serverInvitations.serverId))
    .innerJoin(users, eq(users.id, serverInvitations.inviterId))
    .where(and(
      eq(serverInvitations.inviteeId, userId),
      eq(serverInvitations.status, 'pending'),
      pattern ? sql`(lower(${servers.name}) like ${pattern} or lower(${users.username}) like ${pattern} or lower(${users.displayName}) like ${pattern})` : undefined,
      cursor ? sql`(${serverInvitations.createdAt}, ${serverInvitations.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(serverInvitations.createdAt), desc(serverInvitations.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id, at: r.ts,
      server: { id: r.serverId, name: r.serverName, icon: r.serverIcon, memberCount: r.memberCount },
      inviter: toSocialUser(r.inviter),
    })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.id) : null,
  };
}

/** Pending invitations SENT for one server — for whoever manages it. */
export async function listServerInvitations(actorId: string, serverId: string, cursorRaw?: string): Promise<{ items: SentInvitationEntry[]; nextCursor: string | null } | 'invalid_cursor' | 'forbidden'> {
  if (!hasPermission(await serverPermissions(serverId, actorId), PERMISSIONS.MANAGE_SERVER)) return 'forbidden';
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const inviters = alias(users, 'inviters');
  const rows = await db
    .select({ id: serverInvitations.id, ts: microsecondIso, invitee: users, inviter: inviters })
    .from(serverInvitations)
    .innerJoin(users, eq(users.id, serverInvitations.inviteeId))
    .innerJoin(inviters, eq(inviters.id, serverInvitations.inviterId))
    .where(and(
      eq(serverInvitations.serverId, serverId),
      eq(serverInvitations.status, 'pending'),
      cursor ? sql`(${serverInvitations.createdAt}, ${serverInvitations.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(serverInvitations.createdAt), desc(serverInvitations.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({ id: r.id, at: r.ts, invitee: toSocialUser(r.invitee), inviter: toSocialUser(r.inviter) })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.id) : null,
  };
}

export async function countReceivedInvitations(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(serverInvitations)
    .where(and(eq(serverInvitations.inviteeId, userId), eq(serverInvitations.status, 'pending')));
  return row?.n ?? 0;
}

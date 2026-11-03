import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversationMembers, conversations, messages, type Message, type User } from '../../db/schema.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import * as floodControl from '../../realtime/floodControl.js';
import { participants } from '../presence/participants.js';
import { broadcastToConversationMembers, getOrCreateDirect, touchConversation } from '../conversations/conversationsRepository.js';
import { canSendDirectMessage } from '../friendships/friendshipsRepository.js';
import { queueChatPush } from '../notifications/pushQueue.js';
import { findById, resolveDisplayName } from '../users/users.js';
import { loadCallInviteCards, type CallInviteCard } from './callInviteCards.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'calls' });

// "Convidar para voz": someone in a group's call asks another member of that
// group to join. The invite is a card in their DM, so it reaches them the same
// way a message does (unread count, push) and only between friends — the DM's
// own rule. A pending group invitation is not membership, so it never counts.

// one nudge per person per window: the card is a notification, not a ring
const INVITE_WINDOW_MS = 30_000;

export type CallInviteRefusal = 'not_found' | 'not_in_call' | 'not_member' | 'already_in_call' | 'not_friends' | 'rate_limited';

/** Every rule that doesn't need the database, in the order the caller should
 * hear about it. Pure so the precedence is pinned by a test. */
export function callInviteRefusal(input: {
  inviterId: string;
  inviteeId: string;
  groupType: string | null;
  inviterInCall: boolean;
  inviteeIsMember: boolean;
  inviteeInCall: boolean;
}): Exclude<CallInviteRefusal, 'not_friends' | 'rate_limited'> | null {
  if (input.groupType !== 'group') return 'not_found';
  if (!input.inviterInCall) return 'not_in_call';
  if (!input.inviteeId || input.inviteeId === input.inviterId || !input.inviteeIsMember) return 'not_member';
  if (input.inviteeInCall) return 'already_in_call';
  return null;
}

function inCall(userId: string, conversationId: string): boolean {
  for (const p of participants.values()) {
    if (p.userId === userId && p.callConversationId === conversationId) return true;
  }
  return false;
}

/** Same shape `rowToMessage` produces for a `call_invite` row — built here
 * because messages.ts reads this module's leaf, not the other way around. */
function cardMessagePayload(message: Message, inviter: User, card: CallInviteCard | null) {
  return {
    msgId: message.id, conversationId: message.conversationId, id: inviter.id,
    name: resolveDisplayName(inviter.displayName, inviter.username), avatar: inviter.avatar,
    text: '', ts: message.createdAt.getTime(), kind: 'call_invite' as const, callInvite: card,
  };
}

export async function sendCallInvite(inviterId: string, groupId: string, inviteeId: string): Promise<{ code: 'sent' } | { code: CallInviteRefusal }> {
  const [group] = await db
    .select({ type: conversations.type })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, groupId), eq(conversationMembers.userId, inviterId), eq(conversations.status, 'active')))
    .limit(1);
  const [inviteeMembership] = inviteeId
    ? await db.select({ userId: conversationMembers.userId }).from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, groupId), eq(conversationMembers.userId, inviteeId))).limit(1)
    : [];
  const refusal = callInviteRefusal({
    inviterId, inviteeId, groupType: group?.type ?? null,
    inviterInCall: inCall(inviterId, groupId),
    inviteeIsMember: !!inviteeMembership,
    inviteeInCall: inCall(inviteeId, groupId),
  });
  if (refusal) return { code: refusal };
  if (!(await canSendDirectMessage(inviterId, inviteeId))) return { code: 'not_friends' };
  // counted only once everything else passed, so a refused try doesn't hold the next one back
  if (!floodControl.allow(`call-invite:${inviterId}:${groupId}:${inviteeId}`, { windowMs: INVITE_WINDOW_MS, max: 1 })) return { code: 'rate_limited' };

  const inviter = await findById(inviterId);
  if (!inviter) return { code: 'not_found' };
  const message = await db.transaction(async (tx) => {
    const { conversation: dm } = await getOrCreateDirect(inviterId, inviteeId, inviterId, tx);
    const [row] = await tx.insert(messages).values({
      conversationId: dm.id, authorId: inviterId, text: '', kind: 'call_invite', callConversationId: groupId,
    }).returning();
    await queueChatPush(tx, row!);
    return row!;
  });

  try {
    const card = (await loadCallInviteCards([groupId])).get(groupId) ?? null;
    await touchConversation(message.conversationId, message.createdAt);
    await broadcastToConversationMembers(message.conversationId, { t: 'chat', message: cardMessagePayload(message, inviter, card) });
  } catch (err) {
    // the card is stored: it shows on the next history load
    log.error('failed to announce a call invite', err);
  }
  return { code: 'sent' };
}

async function handleInvite(request: FastifyRequest<{ Params: { conversationId: string } }>, reply: FastifyReply): Promise<void> {
  const sess = await resolveSession(parseCookies(request.headers.cookie || '')[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const groupId = String(request.params.conversationId || '');
  const inviteeId = String(jsonBody(request.body).userId || '');
  if (!floodControl.allow(`call-invite:${sess.userId}`, { windowMs: 60_000, max: 30 })) {
    return sendError(reply, 429, 'rate_limited', 'Você está enviando convites rápido demais. Espere um pouco.');
  }
  const result = await sendCallInvite(sess.userId, groupId, inviteeId);
  switch (result.code) {
    case 'sent': return sendJson(reply, 200, { ok: true });
    case 'not_found': return sendError(reply, 404, 'not_found', 'Grupo não encontrado.');
    case 'not_in_call': return sendError(reply, 403, 'forbidden', 'Entre na chamada para convidar alguém.');
    case 'not_member': return sendError(reply, 404, 'user_unavailable', 'Essa pessoa não está no grupo.');
    case 'already_in_call': return sendError(reply, 409, 'conflict', 'Essa pessoa já está na chamada.');
    case 'not_friends': return sendError(reply, 403, 'relationship_required', 'Vocês precisam ser amigos para enviar um convite.');
    case 'rate_limited': return sendError(reply, 429, 'rate_limited', 'Você acabou de convidar essa pessoa. Espere um pouco.');
  }
}

export function registerCallInviteRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/calls/:conversationId/invites', handleInvite);
}

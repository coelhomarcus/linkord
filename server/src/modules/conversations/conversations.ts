import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers } from '../../db/schema.js';
import { participants, send, sendToUser } from '../presence/participants.js';
import { refreshKnownPeers } from '../presence/knownPeers.js';
import { canSendDirectMessage } from '../friendships/friendshipsRepository.js';
import { getOrCreateDirect, getConversationForUser, rowToSummary } from './conversationsRepository.js';
import type { AppSocket, HandlerTable } from '../../types.js';

// The socket handlers for DM actions (open, close, pin) — never imported
// individually, only dispatched as a block via `handlers`. The repository
// API other modules actually depend on (listForUser, touchConversation,
// etc.) lives in conversationsRepository.ts. Servers and their channels are
// managed over HTTP (modules/servers).

/** Creates the DM (or finds the existing one) and hands it straight to the
 * OPENER only — never broadcasts to the other side. `listForUser` won't
 * surface an empty (or closed) direct conversation, so without this the
 * opener's own client would have nothing to render for it either; sending
 * the summary directly lets them see/type into it for this session without
 * it being "real" history for anyone until an actual message is sent
 * (touchConversation already broadcasts to both sides at that point).
 *
 * Gated like a send: opening a DM writes membership rows for both accounts,
 * so with anyone it would be a way to plant a conversation with a stranger.
 * A refusal is silent, the same as an unknown id, so it says nothing about
 * whether the account exists or blocked the caller. */
async function handleDirectOpen(socket: AppSocket, msg: { userId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const otherUserId = String(msg.userId || '');
  if (!otherUserId || otherUserId === p.userId || !(await canSendDirectMessage(p.userId, otherUserId))) return;

  const { conversation } = await getOrCreateDirect(p.userId, otherUserId, p.userId);

  send(socket, {
    t: 'conversation-opened',
    conversationId: conversation.id,
    conversation: rowToSummary(conversation, [p.userId, otherUserId]),
  });
  // the peer is a friend, so normally already known; a set that went stale
  // (a friendship this connection missed) would leave the client with a
  // conversation member whose profile it was never sent, so heal it here.
  if (!p.knownPeerIds.has(otherUserId)) await refreshKnownPeers([p.userId, otherUserId]);
}

/** Discord-style "Close DM" — drops it from the caller's OWN sidebar
 * without touching the conversation, its messages, or the other member's
 * membership row. `listForUser` re-surfaces it automatically once a message
 * newer than this arrives (from either side); reopening it before that
 * (handleDirectOpen) shows it again for this session without un-hiding it. */
async function handleConversationClose(socket: AppSocket, msg: { conversationId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
  const conversation = await getConversationForUser(conversationId, p.userId);
  if (!conversation || conversation.type !== 'direct') return;

  await db.update(conversationMembers)
    .set({ hiddenAt: new Date() })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, p.userId)));
  // Same event the client already understands as "gone from my sidebar" —
  // closing a DM only ever affects the closer's own view (other tabs
  // included), never anyone else's.
  sendToUser(p.userId, { t: 'conversation-deleted', conversationId });
}

export const handlers: HandlerTable = {
  'direct-open': handleDirectOpen,
  'conversation-close': handleConversationClose,
};

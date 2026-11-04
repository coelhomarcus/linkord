import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, users } from '../../db/schema.js';
import { participants, send, sendToUser } from '../presence/participants.js';
import { refreshKnownPeers } from '../presence/knownPeers.js';
import { getOrCreateDirect, getConversationForUser, rowToSummary } from './conversationsRepository.js';
import type { AppSocket, HandlerTable } from '../../types.js';

// The socket handlers for DM actions (open, close, pin) — never imported
// individually, only dispatched as a block via `handlers`. The repository
// API other modules actually depend on (listForUser, touchConversation,
// etc.) lives in conversationsRepository.ts. Servers and their channels are
// managed over HTTP (modules/servers).

async function findUser(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return !!row;
}

/** Creates the DM (or finds the existing one) and hands it straight to the
 * OPENER only — never broadcasts to the other side. `listForUser` won't
 * surface an empty (or closed) direct conversation, so without this the
 * opener's own client would have nothing to render for it either; sending
 * the summary directly lets them see/type into it for this session without
 * it being "real" history for anyone until an actual message is sent
 * (touchConversation already broadcasts to both sides at that point). */
async function handleDirectOpen(socket: AppSocket, msg: { userId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const otherUserId = String(msg.userId || '');
  if (!otherUserId || otherUserId === p.userId || !(await findUser(otherUserId))) return;

  const { conversation } = await getOrCreateDirect(p.userId, otherUserId, p.userId);

  send(socket, {
    t: 'conversation-opened',
    conversationId: conversation.id,
    conversation: rowToSummary(conversation, [p.userId, otherUserId], null),
  });
  // a peer this connection has never had in its known set (a brand-new DM,
  // or one that predates the connection) — without this the client gets a
  // conversation with a member whose profile it was never sent. Conditioned
  // on the set rather than on "was just created" so it also self-heals.
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

/** Per-member DM pin — a personal sort-to-top on the caller's own
 * sidebar, doesn't touch the conversation or anyone else's row. */
async function handleConversationPin(socket: AppSocket, msg: { conversationId?: string; pinned?: boolean }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
  const conversation = await getConversationForUser(conversationId, p.userId);
  if (!conversation || conversation.type !== 'direct') return;

  const [updated] = await db.update(conversationMembers)
    .set({ pinnedAt: msg.pinned ? new Date() : null })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, p.userId)))
    .returning({ pinnedAt: conversationMembers.pinnedAt });
  sendToUser(p.userId, { t: 'conversation-pinned', conversationId, pinnedAt: updated?.pinnedAt ? updated.pinnedAt.getTime() : null });
}

export const handlers: HandlerTable = {
  'direct-open': handleDirectOpen,
  'conversation-close': handleConversationClose,
  'conversation-pin': handleConversationPin,
};

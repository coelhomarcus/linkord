import { and, count, desc, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, conversations, messages, users } from '../../db/schema.js';
import { parseSerialId } from '../../db/serialId.js';
import { ERROR_CODES } from '../../http/errors.js';
import { participants, send, sendToUser } from '../presence/participants.js';
import {
  broadcastToConversationMembers,
  getConversationForUser,
  getDirectPeerId,
  isServerChannel,
} from '../conversations/conversationsRepository.js';
import { canSendDirectMessage } from '../friendships/friendshipsRepository.js';
import { hasPermission, PERMISSIONS } from '../servers/permissions.js';
import { channelPermissions } from '../servers/serverAccess.js';
import { recordServerAudit } from '../servers/serverAuditLog.js';
import type { AppSocket, HandlerTable, Participant } from '../../types.js';
import {
  announceStoredMessage,
  answerAction,
  authorIdentityOf,
  broadcastChanged,
  messageWithAuthorSelect,
  serializeRows,
  type ActionFailure,
} from './messages.js';

// Pinned messages: a flag on the message, listed per conversation newest pin
// first. Pinning posts a `pin_notice` that only points at the message, so its
// text never travels further than the message itself already does.

/** Discord's cap. A channel past it has stopped being a list anyone reads. */
export const MAX_PINS_PER_CONVERSATION = 250;
const PINS_PAGE_SIZE = 25;

/** Who may pin here: in a server channel PIN_MESSAGES, in a DM either side
 * while they may still write to each other. */
async function pinnableConversation(p: Participant, conversationId: string): Promise<{ id: string; serverId: string | null; title: string } | ActionFailure> {
  const conversation = await getConversationForUser(conversationId, p.userId);
  if (!conversation) return { code: 'conversation_not_found', message: 'Conversa não encontrada.' };
  if (isServerChannel(conversation)) {
    const granted = await channelPermissions(conversation.serverId, conversation.id, p.userId);
    if (!hasPermission(granted, PERMISSIONS.PIN_MESSAGES)) return { code: ERROR_CODES.forbidden, message: 'Você não pode fixar mensagens nesse canal.' };
    return conversation;
  }
  const peerId = await getDirectPeerId(conversation.id, p.userId);
  if (peerId && !(await canSendDirectMessage(p.userId, peerId))) return { code: ERROR_CODES.relationshipRequired, message: 'Vocês precisam ser amigos pra conversar por aqui.' };
  return conversation;
}

/** Marks the pins of a conversation as seen by one account, up to now. */
async function markPinsSeen(conversation: { id: string; serverId: string | null }, userId: string, at: Date = new Date()): Promise<void> {
  if (isServerChannel(conversation)) {
    await db.execute(sql`
      insert into channel_read_states (channel_id, user_id, pins_seen_at) values (${conversation.id}, ${userId}, ${at})
      on conflict (channel_id, user_id) do update set pins_seen_at = excluded.pins_seen_at
    `);
    return;
  }
  await db.update(conversationMembers).set({ pinsSeenAt: at })
    .where(and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.userId, userId)));
}

/** The conversations, among `conversationIds`, pinned to since the account
 * last opened their pins: the header's dot. */
export async function conversationsWithUnseenPins(userId: string, conversationIds: string[]): Promise<string[]> {
  if (!conversationIds.length) return [];
  const ids = sql.join(conversationIds.map((id) => sql`${id}`), sql`, `);
  const result = await db.execute(sql`
    select c.id from conversations c
    left join conversation_members cm on cm.conversation_id = c.id and cm.user_id = ${userId}
    left join channel_read_states rs on rs.channel_id = c.id and rs.user_id = ${userId}
    where c.id in (${ids}) and c.last_pin_at is not null
      and c.last_pin_at > coalesce(case when c.type = 'direct' then cm.pins_seen_at else rs.pins_seen_at end, '-infinity'::timestamptz)
  `);
  return (result.rows as { id: string }[]).map((r) => r.id);
}

async function setPinned(p: Participant, msg: { msgId?: unknown; pinned?: unknown }): Promise<ActionFailure | null> {
  const msgId = parseSerialId(msg.msgId);
  if (msgId === null || typeof msg.pinned !== 'boolean') return { code: 'invalid_message', message: 'Pedido inválido.' };
  const pinned = msg.pinned;
  const [row] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!row) return { code: 'not_found', message: 'Essa mensagem não existe mais.' };
  const conversation = await pinnableConversation(p, row.conversationId);
  if ('code' in conversation) return conversation;
  if (row.kind !== 'text') return { code: ERROR_CODES.forbidden, message: 'Só mensagens podem ser fixadas.' };
  // a repeat changes nothing and tells nobody anything
  if ((row.pinnedAt !== null) === pinned) return null;

  const now = new Date();
  let noticeId: number | null = null;
  const result = await db.transaction(async (tx) => {
    if (pinned) {
      // a row lock on the conversation keeps two pins at the limit from both getting in
      await tx.execute(sql`select 1 from conversations where id = ${conversation.id} for update`);
      const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(messages)
        .where(and(eq(messages.conversationId, conversation.id), isNotNull(messages.pinnedAt)));
      if (n >= MAX_PINS_PER_CONVERSATION) return { code: 'pins_full', message: `Essa conversa já tem ${MAX_PINS_PER_CONVERSATION} mensagens fixadas. Desafixe alguma antes.` } satisfies ActionFailure;
    }
    const [updated] = await tx.update(messages)
      .set(pinned ? { pinnedAt: now, pinnedBy: p.userId } : { pinnedAt: null, pinnedBy: null })
      .where(eq(messages.id, msgId)).returning();
    if (pinned) {
      await tx.update(conversations).set({ lastPinAt: now }).where(eq(conversations.id, conversation.id));
      const [notice] = await tx.insert(messages).values({
        conversationId: conversation.id, authorId: p.userId, text: '', kind: 'pin_notice', pinnedMessageId: msgId,
      }).returning({ id: messages.id });
      noticeId = notice!.id;
    }
    if (isServerChannel(conversation)) {
      const [author] = row.authorId ? await tx.select({ username: users.username }).from(users).where(eq(users.id, row.authorId)).limit(1) : [];
      // ids and names only, never the message body
      await recordServerAudit(tx, {
        serverId: conversation.serverId, actorId: p.userId, action: pinned ? 'message.pin' : 'message.unpin', targetType: 'message', targetId: String(msgId),
        extra: { channelId: conversation.id, channel: conversation.title, authorId: row.authorId, author: author?.username ?? '' },
      });
    }
    return updated!;
  });
  if ('code' in result) return result;

  // whoever pinned has seen it: no dot for them
  if (pinned) await markPinsSeen(conversation, p.userId, now);
  await broadcastChanged(result, await authorIdentityOf(result));
  if (noticeId !== null) await announceStoredMessage(noticeId);
  const [current] = await db.select({ lastPinAt: conversations.lastPinAt }).from(conversations).where(eq(conversations.id, conversation.id)).limit(1);
  await broadcastToConversationMembers(conversation.id, {
    t: 'conversation-pins-updated',
    conversationId: conversation.id,
    lastPinAt: current?.lastPinAt?.getTime() ?? null,
    pinned,
    by: p.userId,
  });
  return null;
}

async function handleMessagePin(socket: AppSocket, msg: { msgId?: unknown; pinned?: unknown; requestId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  answerAction(socket, msg, await setPinned(p, msg));
}

/** One page of a conversation's pins, newest pin first; `before` is the
 * `pinnedAt` of the last one already shown. */
async function handlePinsList(socket: AppSocket, msg: { conversationId?: unknown; before?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = typeof msg.conversationId === 'string' ? msg.conversationId : '';
  const conversation = conversationId ? await getConversationForUser(conversationId, p.userId) : null;
  if (!conversation) return;
  const before = typeof msg.before === 'number' && Number.isFinite(msg.before) ? new Date(msg.before) : null;
  const rows = await db.select(messageWithAuthorSelect).from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(
      eq(messages.conversationId, conversationId),
      isNotNull(messages.pinnedAt),
      ...(before ? [lt(messages.pinnedAt, before)] : []),
    ))
    .orderBy(desc(messages.pinnedAt), desc(messages.id))
    .limit(PINS_PAGE_SIZE + 1);
  const page = rows.slice(0, PINS_PAGE_SIZE);
  const serialized = await serializeRows(page);
  send(socket, {
    t: 'pins-list-result',
    conversationId,
    before: before?.getTime() ?? null,
    items: serialized.map((message, i) => ({ message, pinnedAt: page[i]!.pinnedAt!.getTime() })),
    hasMore: rows.length > PINS_PAGE_SIZE,
  });
}

async function handlePinsAck(socket: AppSocket, msg: { conversationId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = typeof msg.conversationId === 'string' ? msg.conversationId : '';
  const conversation = conversationId ? await getConversationForUser(conversationId, p.userId) : null;
  if (!conversation) return;
  await markPinsSeen(conversation, p.userId);
  // the account's other tabs drop their dot too
  sendToUser(p.userId, { t: 'pins-seen', conversationId });
}

export const handlers: HandlerTable = {
  'message-pin': handleMessagePin,
  'pins-list': handlePinsList,
  'pins-ack': handlePinsAck,
};

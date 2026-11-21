import { and, count, desc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { messages, savedMessages, users } from '../../db/schema.js';
import { parseSerialId } from '../../db/serialId.js';
import { participants, send, sendToUser } from '../presence/participants.js';
import { conversationDisplayName, conversationExistsForUser, visibleConversationIds } from '../conversations/conversationsRepository.js';
import type { AppSocket, HandlerTable, Participant } from '../../types.js';
import { answerAction, messageWithAuthorSelect, serializeRows, type ActionFailure } from './messages.js';

// Saved messages: an account's own list of messages to come back to, across
// every conversation it can read. Nobody else ever hears about it. A deleted
// message leaves every list through the foreign key's cascade.

/** Enough for a reading list; past it the list stops being one. */
export const MAX_SAVED_MESSAGES = 300;
const SAVED_PAGE_SIZE = 25;

/** The ids of everything the account saved, for the welcome: every tab knows
 * at once whether a message reads "Salvar" or "Remover dos salvos". */
export async function savedMessageIds(userId: string): Promise<number[]> {
  const rows = await db.select({ id: savedMessages.messageId }).from(savedMessages)
    .where(eq(savedMessages.userId, userId)).orderBy(desc(savedMessages.savedAt)).limit(MAX_SAVED_MESSAGES);
  return rows.map((r) => r.id);
}

async function setSaved(p: Participant, msg: { msgId?: unknown; saved?: unknown }): Promise<ActionFailure | null> {
  const msgId = parseSerialId(msg.msgId);
  if (msgId === null || typeof msg.saved !== 'boolean') return { code: 'invalid_message', message: 'Pedido inválido.' };
  if (!msg.saved) {
    // removing never needs access: a message the account can no longer read still leaves its list
    const removed = await db.delete(savedMessages).where(and(eq(savedMessages.userId, p.userId), eq(savedMessages.messageId, msgId))).returning({ id: savedMessages.messageId });
    if (removed.length) sendToUser(p.userId, { t: 'saved-updated', msgId, saved: false });
    return null;
  }
  const [row] = await db.select({ conversationId: messages.conversationId, kind: messages.kind }).from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!row || !(await conversationExistsForUser(row.conversationId, p.userId))) return { code: 'not_found', message: 'Essa mensagem não existe mais.' };
  if (row.kind === 'pin_notice') return { code: 'forbidden', message: 'Esse aviso não pode ser salvo.' };
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(savedMessages).where(eq(savedMessages.userId, p.userId));
  if (n >= MAX_SAVED_MESSAGES) return { code: 'saved_full', message: `Você já salvou ${MAX_SAVED_MESSAGES} mensagens. Remova alguma antes.` };
  const [inserted] = await db.insert(savedMessages).values({ userId: p.userId, messageId: msgId, conversationId: row.conversationId })
    .onConflictDoNothing().returning({ savedAt: savedMessages.savedAt });
  if (inserted) sendToUser(p.userId, { t: 'saved-updated', msgId, saved: true, savedAt: inserted.savedAt.getTime() });
  return null;
}

async function handleMessageSave(socket: AppSocket, msg: { msgId?: unknown; saved?: unknown; requestId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  answerAction(socket, msg, await setSaved(p, msg));
}

/** One page of the account's saved messages, newest save first; `before` is
 * the `savedAt` of the last one already shown. A message in a conversation the
 * account can no longer read comes back without its content, so it can still
 * be removed instead of silently vanishing. */
async function handleSavedList(socket: AppSocket, msg: { before?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const before = typeof msg.before === 'number' && Number.isFinite(msg.before) ? new Date(msg.before) : null;
  const saved = await db.select().from(savedMessages)
    .where(and(eq(savedMessages.userId, p.userId), ...(before ? [lt(savedMessages.savedAt, before)] : [])))
    .orderBy(desc(savedMessages.savedAt), desc(savedMessages.messageId))
    .limit(SAVED_PAGE_SIZE + 1);
  const page = saved.slice(0, SAVED_PAGE_SIZE);
  const visible = new Set(await visibleConversationIds(p.userId));
  const readableIds = page.filter((s) => visible.has(s.conversationId)).map((s) => s.messageId);
  const rows = readableIds.length
    ? await db.select(messageWithAuthorSelect).from(messages).leftJoin(users, eq(users.id, messages.authorId)).where(inArray(messages.id, readableIds))
    : [];
  const byId = new Map((await serializeRows(rows)).map((m) => [m.msgId, m]));
  const names = new Map<string, string>();
  for (const id of new Set(page.filter((s) => visible.has(s.conversationId)).map((s) => s.conversationId))) {
    names.set(id, await conversationDisplayName(id, p.userId));
  }
  send(socket, {
    t: 'saved-list-result',
    before: before?.getTime() ?? null,
    items: page.map((s) => {
      const message = byId.get(s.messageId);
      return message
        ? { msgId: s.messageId, conversationId: s.conversationId, conversationName: names.get(s.conversationId) ?? '', savedAt: s.savedAt.getTime(), status: 'available', message }
        : { msgId: s.messageId, conversationId: s.conversationId, conversationName: '', savedAt: s.savedAt.getTime(), status: 'missing', message: null };
    }),
    hasMore: saved.length > SAVED_PAGE_SIZE,
  });
}

export const handlers: HandlerTable = {
  'message-save': handleMessageSave,
  'saved-list': handleSavedList,
};

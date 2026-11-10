import { formatDateHeading } from '@/shared/lib/formatChatTime';
import type { ChatMessage } from '@/shared/types/protocol';
import type { OutboxEntry } from './useMessageOutbox';

const GROUP_GAP_MS = 5 * 60 * 1000;
export type TimelineItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'unread'; key: string }
  | { type: 'message'; key: string; message: ChatMessage; showHeader: boolean; pending?: OutboxEntry };

/** Who the pending copies are drawn as — they have no server row yet. */
export interface PendingAuthor { userId: string | null; name: string; avatar: string }

// A correlated send keeps the same key from pending to stored, so the row
// is updated in place instead of remounting (and re-running its media).
function messageKey(message: ChatMessage): string {
  return message.clientMessageId ? `c:${message.clientMessageId}` : String(message.msgId);
}

/** `hasOlder`: the window doesn't start at the conversation's beginning. The
 * new-messages line then goes in only where both sides of it are loaded: a
 * first unread message older than the window sits in a page not fetched yet,
 * and a line at the window's top would mark the wrong place. */
export function buildTimelineItems(messages: ChatMessage[], pending: OutboxEntry[] = [], author?: PendingAuthor, firstUnreadMessageId?: number, hasOlder = false): TimelineItem[] {
  const stored = new Set(messages.flatMap((message) => (message.clientMessageId ? [message.clientMessageId] : [])));
  const rows: { message: ChatMessage; pending?: OutboxEntry }[] = messages.map((message) => ({ message }));
  pending.forEach((entry, index) => {
    // the stored copy can land a render before the outbox lets go of it
    if (stored.has(entry.clientMessageId)) return;
    rows.push({
      pending: entry,
      message: {
        msgId: -(index + 1),
        conversationId: entry.conversationId,
        id: author?.userId ?? null,
        name: author?.name ?? '',
        avatar: author?.avatar ?? '',
        text: entry.text,
        ts: entry.createdAt,
        replyTo: entry.replyTo,
        clientMessageId: entry.clientMessageId,
        ...(entry.sticker ? { sticker: entry.sticker } : {}),
      },
    });
  });

  const items: TimelineItem[] = [];
  let lastMsg: ChatMessage | null = null;
  let lastDateKey = '';
  let unreadInserted = false;
  let storedBefore = false;
  for (const { message, pending: entry } of rows) {
    const dateKey = new Date(message.ts).toDateString();
    if (dateKey !== lastDateKey) {
      items.push({ type: 'date', key: `date-${dateKey}`, label: formatDateHeading(message.ts) });
      lastDateKey = dateKey;
      lastMsg = null;
    }
    if (!unreadInserted && firstUnreadMessageId !== undefined && !entry && message.msgId >= firstUnreadMessageId) {
      unreadInserted = true;
      if (storedBefore || !hasOlder || message.msgId === firstUnreadMessageId) {
        // two hairlines stacked read as a glitch: when the day starts with the
        // first unread message, the new-messages line takes the date's place
        if (items.at(-1)?.type === 'date') items.pop();
        items.push({ type: 'unread', key: `unread-${firstUnreadMessageId}` });
        lastMsg = null;
      }
    }
    if (!entry) storedBefore = true;
    const isCallLog = message.kind === 'dm_call';
    const showHeader = !isCallLog && (!lastMsg || lastMsg.id !== message.id || message.ts - lastMsg.ts > GROUP_GAP_MS);
    items.push({ type: 'message', key: messageKey(message), message, showHeader, ...(entry ? { pending: entry } : {}) });
    lastMsg = isCallLog ? null : message;
  }
  return items;
}

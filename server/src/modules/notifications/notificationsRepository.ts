import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/client.js';
import { conversations, friendships, groupInvitations, messages, notifications, users, type User } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import type { Tx } from '../users/userPairLock.js';

// Leaf module (db/schema + cursor helpers only): friendships/ and conversations/
// call markNotificationsRead INSIDE their own transactions, so it must not
// depend on either of them.

/** Answering a request or an invitation settles its notification — nobody
 * should keep an unread "you have a request" for something already handled. */
export async function markNotificationsRead(tx: Tx | typeof db, ref: { friendshipId: string } | { invitationIds: string[] }): Promise<void> {
  if ('friendshipId' in ref) {
    await tx.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.friendshipId, ref.friendshipId), eq(notifications.kind, 'friend_request'), isNull(notifications.readAt)));
    return;
  }
  if (ref.invitationIds.length === 0) return;
  await tx.update(notifications).set({ readAt: new Date() })
    .where(and(inArray(notifications.groupInvitationId, ref.invitationIds), isNull(notifications.readAt)));
}

/** Reading a conversation up to a message settles the mentions up to it —
 * the same "I've seen this" opening it already means for its unread count.
 * Returns how many it settled, so the caller only refreshes the bell when
 * something changed. */
export async function markMentionsRead(userId: string, conversationId: string, upToMessageId: number): Promise<number> {
  const rows = await db.update(notifications).set({ readAt: new Date() })
    .where(and(
      eq(notifications.recipientId, userId),
      eq(notifications.kind, 'mention'),
      isNull(notifications.readAt),
      sql`${notifications.messageId} in (select m.id from messages m where m.conversation_id = ${conversationId} and m.id <= ${upToMessageId})`,
    ))
    .returning({ id: notifications.id });
  return rows.length;
}

const MENTION_EXCERPT_LEN = 140;

const createdAtIso = sql<string>`to_char(${notifications.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface NotificationEntry {
  id: string; kind: string; at: string; read: boolean; friendshipId: string | null; invitationId: string | null;
  /** Who caused it; null once that account no longer exists, and for a bot's mention. */
  actor: SocialUser | null;
  /** Only for group invitations; null once the group is gone. */
  group: { id: string; title: string; avatar: string } | null;
  /** Only for mentions: where it was, and the start of what was said. */
  mention: {
    messageId: number; excerpt: string;
    conversation: { id: string; type: 'direct' | 'group' | 'bot'; title: string; avatar: string };
  } | null;
}

interface NotificationRow {
  id: string; kind: string; readAt: Date | null; friendshipId: string | null; invitationId: string | null;
}

type ConversationRef = { id: string; type: string; title: string; avatar: string };

export function toNotificationEntry(
  row: NotificationRow, at: string, actor: User | null, conversation: ConversationRef | null, message: { id: number; text: string } | null = null,
): NotificationEntry {
  return {
    id: row.id, kind: row.kind, at, read: row.readAt !== null, friendshipId: row.friendshipId, invitationId: row.invitationId,
    actor: actor ? toSocialUser(actor) : null,
    group: row.kind === 'group_invitation' && conversation ? { id: conversation.id, title: conversation.title, avatar: conversation.avatar } : null,
    mention: row.kind === 'mention' && conversation && message ? {
      messageId: message.id,
      excerpt: message.text.replace(/\s+/g, ' ').trim().slice(0, MENTION_EXCERPT_LEN),
      conversation: { id: conversation.id, type: conversation.type === 'group' || conversation.type === 'bot' ? conversation.type : 'direct', title: conversation.title, avatar: conversation.avatar },
    } : null,
  };
}

/** The recipient's own notifications, newest first. Nobody else's are ever
 * reachable: the recipient comes from the session, never from the request. */
export async function listNotifications(userId: string, cursorRaw?: string): Promise<{ items: NotificationEntry[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const actors = alias(users, 'actor');
  // Whose action produced the notification depends on its kind: the requester,
  // the other side of the friendship (who accepted), the inviter, or whoever
  // wrote the mention.
  const actorId = sql`case ${notifications.kind}
    when 'friend_request' then ${friendships.requestedBy}
    when 'friend_accepted' then case when ${friendships.userLowId} = ${userId} then ${friendships.userHighId} else ${friendships.userLowId} end
    when 'mention' then ${messages.authorId}
    else ${groupInvitations.inviterId} end`;
  const rows = await db.select({ row: notifications, ts: createdAtIso, actor: actors, conversation: conversations, message: { id: messages.id, text: messages.text } }).from(notifications)
    .leftJoin(friendships, eq(friendships.id, notifications.friendshipId))
    .leftJoin(groupInvitations, eq(groupInvitations.id, notifications.groupInvitationId))
    .leftJoin(messages, eq(messages.id, notifications.messageId))
    .leftJoin(conversations, sql`${conversations.id} = coalesce(${groupInvitations.conversationId}, ${messages.conversationId})`)
    .leftJoin(actors, sql`${actors.id} = ${actorId}`)
    .where(and(
      eq(notifications.recipientId, userId),
      cursor ? sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(({ row, ts, actor, conversation, message }) => toNotificationEntry(
      { id: row.id, kind: row.kind, readAt: row.readAt, friendshipId: row.friendshipId, invitationId: row.groupInvitationId },
      ts, actor, conversation ? { id: conversation.id, type: conversation.type, title: conversation.title, avatar: conversation.avatar } : null,
      message?.id ? message : null,
    )),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.row.id) : null,
  };
}

export async function countUnread(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Removes notifications from the recipient's own list. Idempotent, and never
 * reaches someone else's row: the recipient always comes from the session. */
export async function deleteNotification(userId: string, id: string): Promise<number> {
  const rows = await db.delete(notifications)
    .where(and(eq(notifications.recipientId, userId), eq(notifications.id, id)))
    .returning({ id: notifications.id });
  return rows.length;
}

export async function deleteAllNotifications(userId: string): Promise<number> {
  const rows = await db.delete(notifications).where(eq(notifications.recipientId, userId)).returning({ id: notifications.id });
  return rows.length;
}

/** Idempotent: ids that are already read, or belong to someone else, are simply skipped. */
export async function markRead(userId: string, ids: string[] | 'all'): Promise<number> {
  const scope = ids === 'all'
    ? and(eq(notifications.recipientId, userId), isNull(notifications.readAt))
    : and(eq(notifications.recipientId, userId), isNull(notifications.readAt), inArray(notifications.id, ids));
  if (ids !== 'all' && ids.length === 0) return 0;
  const rows = await db.update(notifications).set({ readAt: new Date() }).where(scope).returning({ id: notifications.id });
  return rows.length;
}

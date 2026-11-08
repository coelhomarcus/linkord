import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from '../../db/client.js';
import { conversations, friendships, messages, notifications, serverInvitations, servers, users, type User } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import type { Tx } from '../users/userPairLock.js';

// Leaf module (db/schema + cursor helpers only): friendships/ and servers/
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
    .where(and(inArray(notifications.serverInvitationId, ref.invitationIds), isNull(notifications.readAt)));
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
  /** Only for server invitations; null once the server is gone. */
  server: { id: string; name: string; icon: string } | null;
  /** Only for mentions: where it was, and the start of what was said. */
  mention: {
    messageId: number; excerpt: string;
    conversation: { id: string; type: 'direct' | 'text' | 'voice'; name: string; serverId: string | null; serverName: string; serverIcon: string };
  } | null;
}

interface NotificationRow {
  id: string; kind: string; readAt: Date | null; friendshipId: string | null; invitationId: string | null;
}

type ServerRef = { id: string; name: string; icon: string };
type ConversationRef = { id: string; type: string; title: string; serverId: string | null };

function toNotificationEntry(
  row: NotificationRow, at: string, actor: User | null, server: ServerRef | null,
  conversation: ConversationRef | null = null, message: { id: number; text: string } | null = null,
): NotificationEntry {
  return {
    id: row.id, kind: row.kind, at, read: row.readAt !== null, friendshipId: row.friendshipId, invitationId: row.invitationId,
    actor: actor ? toSocialUser(actor) : null,
    server: row.kind === 'server_invitation' && server ? { id: server.id, name: server.name, icon: server.icon } : null,
    mention: row.kind === 'mention' && conversation && message ? {
      messageId: message.id,
      excerpt: message.text.replace(/\s+/g, ' ').trim().slice(0, MENTION_EXCERPT_LEN),
      conversation: {
        id: conversation.id, type: conversation.type === 'text' || conversation.type === 'voice' ? conversation.type : 'direct', name: conversation.title,
        serverId: conversation.serverId, serverName: server?.name ?? '', serverIcon: server?.icon ?? '',
      },
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
    else ${serverInvitations.inviterId} end`;
  const rows = await db.select({
    row: notifications, ts: createdAtIso, actor: actors, server: { id: servers.id, name: servers.name, icon: servers.icon },
    conversation: { id: conversations.id, type: conversations.type, title: conversations.title, serverId: conversations.serverId },
    message: { id: messages.id, text: messages.text },
  }).from(notifications)
    .leftJoin(friendships, eq(friendships.id, notifications.friendshipId))
    .leftJoin(serverInvitations, eq(serverInvitations.id, notifications.serverInvitationId))
    .leftJoin(messages, eq(messages.id, notifications.messageId))
    .leftJoin(conversations, eq(conversations.id, messages.conversationId))
    .leftJoin(servers, sql`${servers.id} = coalesce(${serverInvitations.serverId}, ${conversations.serverId})`)
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
    items: page.map(({ row, ts, actor, server, conversation, message }) => toNotificationEntry(
      { id: row.id, kind: row.kind, readAt: row.readAt, friendshipId: row.friendshipId, invitationId: row.serverInvitationId },
      ts, actor, server?.id ? server : null, conversation?.id ? conversation : null, message?.id ? message : null,
    )),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.row.id) : null,
  };
}

export async function countUnread(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications)
    .where(and(eq(notifications.recipientId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Unread DMs plus unread notifications — like Discord, a server channel's
 * traffic only reaches the icon through a mention. A DM mention already
 * counts through its unread message, and a server invitation card and its
 * unread notification describe one event, so each is counted once. */
export async function countAppBadge(userId: string): Promise<number> {
  const result = await db.execute(sql`
    select (
      select count(*) from conversation_members cm
      inner join conversations c on c.id = cm.conversation_id
      inner join messages m on m.conversation_id = cm.conversation_id
      where cm.user_id = ${userId}
        and c.type = 'direct'
        and (cm.hidden_at is null or c.last_message_at > cm.hidden_at)
        and m.id > coalesce(cm.last_read_message_id, 0)
        and m.created_at > cm.joined_at
        and m.author_id is distinct from ${userId}
        and not (
          m.kind = 'server_invite' and exists (
            select 1 from notifications invitation
            where invitation.recipient_id = ${userId}
              and invitation.kind = 'server_invitation'
              and invitation.server_invitation_id = m.server_invitation_id
              and invitation.read_at is null
          )
        )
    ) + (
      select count(*) from notifications n
      left join messages mm on mm.id = n.message_id
      left join conversations mc on mc.id = mm.conversation_id
      where n.recipient_id = ${userId} and n.read_at is null and (n.kind <> 'mention' or mc.type <> 'direct')
    ) as count
  `);
  return Number(result.rows[0]?.count ?? 0);
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

export async function getPushShowContent(userId: string): Promise<boolean> {
  const [row] = await db.select({ showContent: users.pushShowContent }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.showContent ?? true;
}

export async function setPushShowContent(userId: string, showContent: boolean): Promise<void> {
  await db.update(users).set({ pushShowContent: showContent }).where(eq(users.id, userId));
}

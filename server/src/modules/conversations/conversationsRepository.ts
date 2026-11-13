import crypto from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { channelReadStates, conversationMembers, conversations, users, type Conversation } from '../../db/schema.js';
import { participants, send } from '../presence/participants.js';
import { resolveDisplayName } from '../users/users.js';
import { hasPermission, PERMISSIONS } from '../servers/permissions.js';
import { channelPermissions, channelPermissionsIn, channelViewerIds, loadServerSnapshot, serverIdsForUser, serverPeerIds } from '../servers/serverAccess.js';
import type { Tx } from '../users/userPairLock.js';

// The conversations API other modules actually depend on (messages.ts,
// moderation.ts, attachmentServing.ts, attachmentUploads.ts) — as opposed
// to the socket handlers for DM actions themselves (direct-open, close,
// pin), which live in conversations.ts and are only dispatched as a block
// via `handlers`.
//
// A conversation is either a DM (two `conversation_members` rows) or a
// server channel (`serverId` set, access resolved from the server's roles
// — modules/servers/serverAccess.ts). Everything here answers for both, so
// messages, uploads, calls and search never need to know which one it is.

export function isServerChannel(conversation: { serverId: string | null }): conversation is { serverId: string } {
  return conversation.serverId !== null;
}

/** A DM as the sidebar shows it. Server channels travel inside their
 * server's summary instead (modules/servers/serverSummaries.ts). */
export interface ConversationSummary {
  id: string;
  type: 'direct';
  memberIds: string[];
  lastMessageAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export function rowToSummary(row: Conversation, memberIds: string[]): ConversationSummary {
  return {
    id: row.id,
    type: 'direct',
    memberIds,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/** The account's DMs. A DM only counts as "history" once `lastMessageAt` is
 * set — opening one (handleDirectOpen) creates the row right away so both
 * sides can chat, but that alone shouldn't plant it in anyone's sidebar.
 * A message and the start of a DM call both set it (touchConversation).
 * The same clause covers "closed" DMs (member.hiddenAt set): hidden until
 * something newer than the close time arrives, then it reappears on its own. */
export async function listForUser(userId: string): Promise<ConversationSummary[]> {
  const rows = await db
    .select({ conversation: conversations })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(
      eq(conversationMembers.userId, userId),
      eq(conversations.type, 'direct'),
      sql`${conversations.lastMessageAt} is not null`,
      or(
        sql`${conversationMembers.hiddenAt} is null`,
        sql`${conversations.lastMessageAt} > ${conversationMembers.hiddenAt}`,
      ),
    ))
    // newest message first — deliberately lastMessageAt, so an edit or delete
    // of an old message never resorts the sidebar (see schema.ts#conversations)
    .orderBy(desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`));

  const ids = rows.map((r) => r.conversation.id);
  const members = new Map<string, string[]>();
  if (ids.length) {
    const memberRows = await db.select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId })
      .from(conversationMembers).where(inArray(conversationMembers.conversationId, ids));
    for (const row of memberRows) members.set(row.conversationId, [...(members.get(row.conversationId) ?? []), row.userId]);
  }
  return rows.map((r) => rowToSummary(r.conversation, members.get(r.conversation.id) ?? []));
}

// the badge reads "99+" past this, so counting further is wasted work
export const UNREAD_COUNT_CAP = 100;

/** Unread messages per conversation — DMs from the member's read marker,
 * text channels from the channel read state, both counted only from when
 * the account joined (a new member would otherwise start with the whole
 * history as unread). Callers pass only conversations the account can see.
 * Only conversations with something unread are present. */
export async function unreadCountsForUser(userId: string, conversationIds: string[]): Promise<Record<string, number>> {
  if (!conversationIds.length) return {};
  const ids = sql.join(conversationIds.map((id) => sql`${id}`), sql`, `);
  const unread = (lastRead: ReturnType<typeof sql>, joinedAt: ReturnType<typeof sql>) => sql`(
    select count(*) from (
      select 1 from messages m
      where m.conversation_id = c.id
        and m.id > coalesce(${lastRead}, 0)
        and m.created_at > ${joinedAt}
        and m.author_id is distinct from ${userId}
      limit ${UNREAD_COUNT_CAP}
    ) capped
  )::int`;
  const result = await db.execute(sql`
    select c.id as conversation_id, ${unread(sql`cm.last_read_message_id`, sql`cm.joined_at`)} as unread
    from conversations c
    inner join conversation_members cm on cm.conversation_id = c.id and cm.user_id = ${userId}
    where c.type = 'direct' and c.id in (${ids})
    union all
    select c.id, ${unread(sql`rs.last_read_message_id`, sql`sm.joined_at`)}
    from conversations c
    inner join servers s on s.id = c.server_id and s.status = 'active'
    inner join server_members sm on sm.server_id = c.server_id and sm.user_id = ${userId}
    left join channel_read_states rs on rs.channel_id = c.id and rs.user_id = ${userId}
    where c.type = 'text' and c.id in (${ids})
  `);
  const out: Record<string, number> = {};
  for (const row of result.rows as { conversation_id: string; unread: number }[]) {
    if (row.unread > 0) out[row.conversation_id] = row.unread;
  }
  return out;
}

/** The first message after the account's read marker — where the client
 * draws the "new messages" line when it opens the conversation. */
export async function firstUnreadMessageId(conversation: Conversation, userId: string): Promise<number | null> {
  const result = isServerChannel(conversation)
    ? await db.execute(sql`
        select min(m.id)::int as id from messages m
        inner join server_members sm on sm.server_id = ${conversation.serverId} and sm.user_id = ${userId}
        left join channel_read_states rs on rs.channel_id = m.conversation_id and rs.user_id = ${userId}
        where m.conversation_id = ${conversation.id}
          and m.id > coalesce(rs.last_read_message_id, 0)
          and m.created_at > sm.joined_at
          and m.author_id is distinct from ${userId}`)
    : await db.execute(sql`
        select min(m.id)::int as id from messages m
        inner join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${userId}
        where m.conversation_id = ${conversation.id}
          and m.id > coalesce(cm.last_read_message_id, 0)
          and m.created_at > cm.joined_at
          and m.author_id is distinct from ${userId}`);
  return (result.rows[0] as { id: number | null } | undefined)?.id ?? null;
}

/** Moves the read marker forward to `messageId` — never back, so a late mark
 * from a slower tab can't resurrect messages another tab already read past.
 * Returns false when the message isn't in that conversation or the marker
 * was already at or past it. */
export async function markReadUpTo(conversation: Conversation, userId: string, messageId: number): Promise<boolean> {
  if (isServerChannel(conversation)) {
    const result = await db.execute(sql`
      insert into channel_read_states (channel_id, user_id, last_read_message_id)
      select ${conversation.id}, ${userId}, ${messageId}
      where exists (select 1 from messages m where m.id = ${messageId} and m.conversation_id = ${conversation.id})
      on conflict (channel_id, user_id) do update set last_read_message_id = excluded.last_read_message_id
      where ${channelReadStates.lastReadMessageId} is null or ${channelReadStates.lastReadMessageId} < excluded.last_read_message_id
    `);
    return (result.rowCount ?? 0) > 0;
  }
  const result = await db.execute(sql`
    update conversation_members cm set last_read_message_id = ${messageId}
    where cm.conversation_id = ${conversation.id}
      and cm.user_id = ${userId}
      and (cm.last_read_message_id is null or cm.last_read_message_id < ${messageId})
      and exists (select 1 from messages m where m.id = ${messageId} and m.conversation_id = ${conversation.id})
  `);
  return (result.rowCount ?? 0) > 0;
}

/** The newest message of a conversation, or null when it has none. */
export async function newestMessageId(conversationId: string): Promise<number | null> {
  const result = await db.execute(sql`select max(m.id)::int as id from messages m where m.conversation_id = ${conversationId}`);
  return (result.rows[0] as { id: number | null } | undefined)?.id ?? null;
}

/** "Mark server as read": every text channel of the server the account can
 * see, moved to its newest message in one statement. Returns the channels
 * whose marker actually moved, for the caller to tell the account's tabs. */
export async function markServerChannelsRead(serverId: string, userId: string): Promise<{ conversationId: string; lastReadMessageId: number }[]> {
  const snapshot = await loadServerSnapshot(serverId);
  if (!snapshot) return [];
  const channelIds = snapshot.channels
    .filter((channel) => channel.type === 'text' && hasPermission(channelPermissionsIn(snapshot, channel.id, userId), PERMISSIONS.VIEW_CHANNEL))
    .map((channel) => channel.id);
  if (!channelIds.length) return [];
  const ids = sql.join(channelIds.map((id) => sql`${id}`), sql`, `);
  const result = await db.execute(sql`
    insert into channel_read_states (channel_id, user_id, last_read_message_id)
    select m.conversation_id, ${userId}, max(m.id) from messages m
    where m.conversation_id in (${ids})
    group by m.conversation_id
    on conflict (channel_id, user_id) do update set last_read_message_id = excluded.last_read_message_id
    where ${channelReadStates.lastReadMessageId} is null or ${channelReadStates.lastReadMessageId} < excluded.last_read_message_id
    returning channel_id, last_read_message_id
  `);
  return (result.rows as { channel_id: string; last_read_message_id: number }[])
    .map((row) => ({ conversationId: row.channel_id, lastReadMessageId: row.last_read_message_id }));
}

async function directMemberRows(conversationId: string) {
  return db.select({ userId: conversationMembers.userId })
    .from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
}

/** Sends the CURRENT state of one DM to both members. */
async function sendConversationUpdateToMembers(t: 'conversation-created' | 'conversation-updated', row: Conversation): Promise<void> {
  if (isServerChannel(row)) return;
  const memberRows = await directMemberRows(row.id);
  const memberIds = memberRows.map((r) => r.userId);
  const summary = rowToSummary(row, memberIds);
  for (const { userId } of memberRows) {
    for (const p of participants.values()) {
      if (p.userId === userId) send(p.socket, { t, conversation: summary });
    }
  }
}

/** Who can read a conversation right now: both sides of a DM, or every
 * server member the channel is visible to. */
export async function conversationAudienceIds(conversation: Pick<Conversation, 'id' | 'serverId'>): Promise<string[]> {
  if (conversation.serverId) {
    const snapshot = await loadServerSnapshot(conversation.serverId);
    return snapshot && snapshot.server.status === 'active' ? channelViewerIds(snapshot, conversation.id) : [];
  }
  return (await directMemberRows(conversation.id)).map((r) => r.userId);
}

export async function broadcastToConversationMembers(conversationId: string, obj: { t: string; [key: string]: unknown }): Promise<void> {
  const [conversation] = await db.select({ id: conversations.id, serverId: conversations.serverId }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation) return;
  const allowed = new Set(await conversationAudienceIds(conversation));
  for (const p of participants.values()) {
    if (allowed.has(p.userId)) send(p.socket, obj);
  }
}

export function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** Finds or creates the direct conversation between two accounts —
 * idempotent under concurrency. The old "select, then insert" would throw on
 * the unique `dm_key` index when two requests raced (and roll the whole
 * transaction back); `ON CONFLICT DO NOTHING` makes the loser wait for the
 * winner's commit and then just read its row. Pass a `tx` to join a caller's
 * transaction (an invitation card is created together with its invitation). */
export async function getOrCreateDirect(a: string, b: string, creatorId: string, executor?: Tx): Promise<{ conversation: Conversation; created: boolean }> {
  const run = async (tx: Tx) => {
    const dmKey = dmKeyFor(a, b);
    const [inserted] = await tx.insert(conversations).values({
      id: crypto.randomUUID(), type: 'direct', title: '', createdBy: creatorId, dmKey, updatedAt: new Date(),
    }).onConflictDoNothing({ target: conversations.dmKey }).returning();
    const conversation = inserted ?? (await tx.select().from(conversations).where(eq(conversations.dmKey, dmKey)).limit(1))[0]!;
    await tx.insert(conversationMembers).values([
      { conversationId: conversation.id, userId: a, role: 'member' },
      { conversationId: conversation.id, userId: b, role: 'member' },
    ]).onConflictDoNothing();
    return { conversation, created: !!inserted };
  };
  return executor ? run(executor) : db.transaction(run);
}

/** THE access gate. A DM: being one of its two members. A channel: being a
 * member of an active server and holding `permission` there — VIEW_CHANNEL
 * by default (every read), SEND_MESSAGES / ATTACH_FILES / ADD_REACTIONS /
 * CONNECT for the writes that need them. A DM ignores `permission`: who may
 * write there is the friendship gate's call (canSendDirectMessage). */
export async function getConversationForUser(conversationId: string, userId: string, permission: number = PERMISSIONS.VIEW_CHANNEL): Promise<Conversation | null> {
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation) return null;
  if (isServerChannel(conversation)) {
    const granted = await channelPermissions(conversation.serverId, conversation.id, userId);
    return hasPermission(granted, PERMISSIONS.VIEW_CHANNEL) && hasPermission(granted, permission) ? conversation : null;
  }
  const [member] = await db.select({ userId: conversationMembers.userId }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId))).limit(1);
  return member ? conversation : null;
}

export async function conversationExistsForUser(conversationId: string, userId: string, permission?: number): Promise<boolean> {
  return !!(await getConversationForUser(conversationId, userId, permission));
}

/** The other member of a DIRECT conversation — null if `userId` isn't a
 * member, or the conversation is a channel (contact restrictions never apply
 * there — the server's roles already govern it). Used by the direct-message
 * write-path gates (canSendDirectMessage). */
export async function getDirectPeerId(conversationId: string, userId: string): Promise<string | null> {
  const conversation = await getConversationForUser(conversationId, userId);
  if (!conversation || conversation.type !== 'direct') return null;
  const [other] = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), sql`${conversationMembers.userId} <> ${userId}`))
    .limit(1);
  return other?.userId ?? null;
}

// A DM only becomes something the two accounts share once a message was sent
// in it (the same line listForUser draws for history). `direct-open` writes
// both membership rows before anything is said, so counting an empty DM would
// let anyone become a "known peer" of anyone, with their presence and profile.
const HAS_HISTORY = sql`(${conversations.type} <> 'direct' or ${conversations.lastMessageAt} is not null)`;

/** Every OTHER account this user shares a DM with history, or a server, with,
 * deduplicated — the "known peers" presence-scoping set
 * (presence/knownPeers.ts). */
export async function listConversationMemberIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(
      sql`${conversationMembers.conversationId} IN (
        select ${conversationMembers.conversationId} from ${conversationMembers} where ${conversationMembers.userId} = ${userId}
      )`,
      sql`${conversationMembers.userId} <> ${userId}`,
      HAS_HISTORY,
    ));
  return [...new Set([...rows.map((r) => r.userId), ...(await serverPeerIds(userId))])];
}

/** Whether `a` and `b` share a DM with history or a server — the
 * profile-visibility check (users/profileAccess.ts), a pairwise question
 * unlike the bulk one above. An empty DM does not count (see HAS_HISTORY). */
export async function shareAnyConversation(a: string, b: string): Promise<boolean> {
  const result = await db.execute(sql`
    select 1 from conversation_members x
    inner join conversation_members y on y.conversation_id = x.conversation_id and y.user_id = ${b}
    inner join conversations c on c.id = x.conversation_id and (c.type <> 'direct' or c.last_message_at is not null)
    where x.user_id = ${a}
    union all
    select 1 from server_members x
    inner join server_members y on y.server_id = x.server_id and y.user_id = ${b}
    where x.user_id = ${a}
    limit 1
  `);
  return result.rows.length > 0;
}

/** Something that should put a DM in history and at the top of the sidebar:
 * a genuinely new message, or a DM call that just started ringing. An edit
 * or a delete must not come through here (see recordConversationActivity).
 * Channels keep their own order, so only a DM's summary is re-sent. */
export async function touchConversation(conversationId: string, when = new Date()): Promise<void> {
  const [row] = await db.update(conversations).set({ lastMessageAt: when, lastActivityAt: when }).where(eq(conversations.id, conversationId)).returning();
  if (row) await sendConversationUpdateToMembers('conversation-updated', row);
}

/** A message was edited or deleted, or a file was attached to a message
 * that already exists — real chat activity, but NOT a new message, so
 * `lastMessageAt` must stay untouched (see touchConversation above for
 * why). Only bumps the bookkeeping-only `lastActivityAt`. */
export async function recordConversationActivity(conversationId: string, when = new Date()): Promise<void> {
  await db.update(conversations).set({ lastActivityAt: when }).where(eq(conversations.id, conversationId));
}

/** How a conversation is named to `viewerUserId`: the other person of a DM,
 * or `#channel` of a server channel. */
export async function conversationDisplayName(conversationId: string, viewerUserId: string): Promise<string> {
  const conversation = await getConversationForUser(conversationId, viewerUserId);
  if (!conversation) return 'conversa';
  if (isServerChannel(conversation)) return `#${conversation.title}`;

  const [other] = await db
    .select({ username: users.username, displayName: users.displayName })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, conversationId), sql`${conversationMembers.userId} <> ${viewerUserId}`))
    .limit(1);
  return other ? resolveDisplayName(other.displayName, other.username) : 'Conversa direta';
}

/** Every conversation the account can read: its DMs and each channel it can
 * see in its servers — what a search across everything covers. */
export async function visibleConversationIds(userId: string): Promise<string[]> {
  const dms = await db.select({ id: conversationMembers.conversationId }).from(conversationMembers).where(eq(conversationMembers.userId, userId));
  const channels: string[] = [];
  for (const serverId of await serverIdsForUser(userId)) {
    const snapshot = await loadServerSnapshot(serverId);
    if (!snapshot) continue;
    for (const channel of snapshot.channels) {
      if (hasPermission(channelPermissionsIn(snapshot, channel.id, userId), PERMISSIONS.VIEW_CHANNEL)) channels.push(channel.id);
    }
  }
  return [...dms.map((r) => r.id), ...channels];
}

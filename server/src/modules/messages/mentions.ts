import crypto from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, notifications, outboxEvents, users } from '../../db/schema.js';
import { messageMentions } from '../link-preview/messageLinks.js';
import { listBlockedEitherWayIds } from '../blocks/blocksRepository.js';
import { notifySocialChanged } from '../presence/knownPeers.js';
import { listVisibleOnlineUserIds } from '../presence/participants.js';
import { channelViewerIds, loadServerSnapshot } from '../servers/serverAccess.js';
import { conversationAudienceIds } from '../conversations/conversationsRepository.js';
import { groupMentionRecipients, NO_GROUP_MENTIONS, type GroupMentions } from './groupMentions.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'mentions' });

// rows per INSERT: an @everyone in a big server is one notification per
// member, and Postgres takes at most 65535 parameters in one statement
const INSERT_CHUNK = 1000;

/** Turns the mentions of a message into notifications for whoever they name
 * — only whoever can read that conversation, never the author, never across a
 * block either way. `groups` is what its @everyone/@here and role mentions
 * may notify (resolveGroupMentions); a name and a group reaching the same
 * member notify them once. Safe to call again for the same message (an
 * edit): a member already notified for it isn't notified twice, while one the
 * edit adds is. `authorId` is null for a bot's message, which no block stops.
 * A fixed number of queries whatever the audience: one for the names, one for
 * the author's blocks, then the inserts. */
export async function notifyMentions(message: { id: number; conversationId: string; text: string; authorId: string | null; groups?: GroupMentions }): Promise<void> {
  const { usernames } = messageMentions(message.text);
  const groups = message.groups ?? NO_GROUP_MENTIONS;
  const hasGroups = groups.everyone || groups.here || groups.roleIds.length > 0;
  if (!usernames.length && !hasGroups) return;
  try {
    const [conversation] = await db.select({ id: conversations.id, serverId: conversations.serverId }).from(conversations)
      .where(eq(conversations.id, message.conversationId)).limit(1);
    if (!conversation) return;
    let audience: string[];
    const reached = new Set<string>();
    if (conversation.serverId) {
      const snapshot = await loadServerSnapshot(conversation.serverId);
      if (!snapshot || snapshot.server.status !== 'active') return;
      audience = channelViewerIds(snapshot, conversation.id);
      const roleIdsOf = (userId: string) => snapshot.members.get(userId)?.roleIds ?? [];
      // online as everyone else sees it: an invisible account is not "here"
      const online = groups.here ? new Set(listVisibleOnlineUserIds()) : new Set<string>();
      for (const userId of groupMentionRecipients(audience, groups, roleIdsOf, (userId) => online.has(userId))) reached.add(userId);
    } else {
      audience = await conversationAudienceIds(conversation);
    }
    if (!audience.length) return;
    if (usernames.length) {
      const named = await db.select({ userId: users.id }).from(users)
        .where(and(inArray(users.id, audience), inArray(sql`lower(${users.username})`, usernames)));
      for (const { userId } of named) reached.add(userId);
    }
    if (message.authorId) {
      reached.delete(message.authorId);
      for (const userId of await listBlockedEitherWayIds(message.authorId)) reached.delete(userId);
    }
    const recipients = [...reached];
    if (!recipients.length) return;

    const notified = await db.transaction(async (tx) => {
      const inserted: string[] = [];
      for (let i = 0; i < recipients.length; i += INSERT_CHUNK) {
        const rows = await tx.insert(notifications).values(recipients.slice(i, i + INSERT_CHUNK).map((recipientId) => ({
          id: crypto.randomUUID(), recipientId, kind: 'mention', messageId: message.id,
          dedupeKey: `mention:${message.id}:${recipientId}`,
        }))).onConflictDoNothing().returning({ recipientId: notifications.recipientId });
        inserted.push(...rows.map((row) => row.recipientId));
      }
      for (let i = 0; i < inserted.length; i += INSERT_CHUNK) {
        await tx.insert(outboxEvents).values(inserted.slice(i, i + INSERT_CHUNK).map((recipientId) => ({
          id: crypto.randomUUID(), type: 'mention_created', audienceUserId: recipientId, payload: { messageId: message.id },
        })));
      }
      return inserted;
    });
    // the bell refetches on this hint; the outbox re-sends it if this one is lost
    notifySocialChanged(notified);
  } catch (err) {
    // a missed notification must never fail the send that already went out
    log.error('failed to notify mentions', err, { messageId: message.id });
  }
}

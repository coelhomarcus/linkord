import crypto from 'node:crypto';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, notifications, outboxEvents, users } from '../../db/schema.js';
import { mentionedUsernames } from '../link-preview/messageLinks.js';
import { isBlockedEitherWay } from '../blocks/blocksRepository.js';
import { notifySocialChanged } from '../presence/knownPeers.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'mentions' });

/** Turns the @mentions of a message into notifications for whoever they name
 * — only members of that conversation, never the author, never across a block
 * either way. Safe to call again for the same message (an edit): a member
 * already notified for it isn't notified twice, while one the edit adds is.
 * `authorId` is null for a bot's message, which notifies everyone it names. */
export async function notifyMentions(message: { id: number; conversationId: string; text: string; authorId: string | null }): Promise<void> {
  const names = mentionedUsernames(message.text);
  if (!names.length) return;
  try {
    const named = await db.select({ userId: users.id }).from(conversationMembers)
      .innerJoin(users, eq(users.id, conversationMembers.userId))
      .where(and(
        eq(conversationMembers.conversationId, message.conversationId),
        inArray(sql`lower(${users.username})`, names),
        message.authorId ? ne(users.id, message.authorId) : undefined,
      ));
    const recipients: string[] = [];
    for (const { userId } of named) {
      if (message.authorId && await isBlockedEitherWay(message.authorId, userId)) continue;
      recipients.push(userId);
    }
    if (!recipients.length) return;

    const notified = await db.transaction(async (tx) => {
      const inserted = await tx.insert(notifications).values(recipients.map((recipientId) => ({
        id: crypto.randomUUID(), recipientId, kind: 'mention', messageId: message.id,
        dedupeKey: `mention:${message.id}:${recipientId}`,
      }))).onConflictDoNothing().returning({ recipientId: notifications.recipientId });
      if (inserted.length) {
        await tx.insert(outboxEvents).values(inserted.map(({ recipientId }) => ({
          id: crypto.randomUUID(), type: 'mention_created', audienceUserId: recipientId, payload: { messageId: message.id },
        })));
      }
      return inserted.map((row) => row.recipientId);
    });
    // the bell refetches on this hint; the outbox re-sends it if this one is lost
    notifySocialChanged(notified);
  } catch (err) {
    // a missed notification must never fail the send that already went out
    log.error('failed to notify mentions', err, { messageId: message.id });
  }
}

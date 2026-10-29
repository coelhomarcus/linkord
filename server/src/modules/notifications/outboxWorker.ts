import { and, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { notifications, outboxEvents } from '../../db/schema.js';
import { notifySocialChanged } from '../presence/knownPeers.js';
import { deliverWebPush } from './webPush.js';
import { OUTBOX_BATCH, OUTBOX_MAX_ATTEMPTS, OUTBOX_RETENTION_DAYS, NOTIFICATION_READ_RETENTION_DAYS, NOTIFICATION_UNREAD_RETENTION_DAYS, daysAgo, nextOutboxState } from './notificationsPolicy.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'outbox' });

/** Rows are claimed with FOR UPDATE SKIP LOCKED across instances. Social
 * events re-emit their payload-free socket hint and send Web Push; chat jobs
 * only send Web Push after their current read/access state has been checked. */
let draining = false;
export async function drainOutbox(): Promise<{ processed: number; failed: number }> {
  if (draining) return { processed: 0, failed: 0 };
  draining = true;
  try {
    return await db.transaction(async (tx) => {
      const batch = await tx.select().from(outboxEvents)
        .where(and(isNull(outboxEvents.processedAt), lt(outboxEvents.attempts, OUTBOX_MAX_ATTEMPTS),
          lt(outboxEvents.createdAt, new Date(Date.now() - 1000))))
        .orderBy(outboxEvents.createdAt)
        .limit(OUTBOX_BATCH)
        .for('update', { skipLocked: true });
      let processed = 0;
      let failed = 0;
      for (const event of batch) {
        let delivered = true;
        try {
          if (event.type !== 'chat_message_push') notifySocialChanged([event.audienceUserId]);
          delivered = await deliverWebPush(event);
        } catch (err) {
          delivered = false;
          log.error('outbox delivery failed', err, { eventId: event.id, type: event.type });
        }
        const state = nextOutboxState(event.attempts, delivered);
        await tx.update(outboxEvents)
          .set({ attempts: state.attempts, processedAt: state.processed ? new Date() : null })
          .where(sql`${outboxEvents.id} = ${event.id}`);
        if (state.processed) processed++; else failed++;
      }
      return { processed, failed };
    });
  } finally {
    draining = false;
  }
}

/** Retention (docs/plano-rede-social.md §10): read notifications and processed
 * outbox rows don't need to live forever. Unread ones are kept much longer. */
export async function pruneNotifications(now = new Date()): Promise<{ notifications: number; outbox: number }> {
  const readCut = daysAgo(NOTIFICATION_READ_RETENTION_DAYS, now);
  const unreadCut = daysAgo(NOTIFICATION_UNREAD_RETENTION_DAYS, now);
  const outboxCut = daysAgo(OUTBOX_RETENTION_DAYS, now);
  const oldRead = await db.delete(notifications)
    .where(sql`${notifications.readAt} is not null and ${notifications.readAt} < ${readCut.toISOString()}::timestamptz`).returning({ id: notifications.id });
  const oldUnread = await db.delete(notifications)
    .where(and(isNull(notifications.readAt), lt(notifications.createdAt, unreadCut))).returning({ id: notifications.id });
  const oldOutbox = await db.delete(outboxEvents)
    .where(sql`${outboxEvents.processedAt} is not null and ${outboxEvents.processedAt} < ${outboxCut.toISOString()}::timestamptz`).returning({ id: outboxEvents.id });
  return { notifications: oldRead.length + oldUnread.length, outbox: oldOutbox.length };
}

export async function outboxStats(): Promise<{ pending: number; failed: number }> {
  const [row] = await db.select({
    pending: sql<number>`count(*) filter (where ${outboxEvents.processedAt} is null and ${outboxEvents.attempts} < ${OUTBOX_MAX_ATTEMPTS})::int`,
    failed: sql<number>`count(*) filter (where ${outboxEvents.processedAt} is null and ${outboxEvents.attempts} >= ${OUTBOX_MAX_ATTEMPTS})::int`,
  }).from(outboxEvents);
  return { pending: row?.pending ?? 0, failed: row?.failed ?? 0 };
}


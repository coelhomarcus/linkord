import crypto from 'node:crypto';
import { and, eq, inArray, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { notifications, outboxEvents, type OutboxEvent } from '../../db/schema.js';
import { notifySocialChanged } from '../presence/knownPeers.js';
import { deliverWebPush } from './webPush.js';
import { OUTBOX_BATCH, OUTBOX_CONCURRENCY, OUTBOX_LEASE_MS, OUTBOX_MAX_ATTEMPTS, OUTBOX_RETENTION_DAYS, NOTIFICATION_READ_RETENTION_DAYS, NOTIFICATION_UNREAD_RETENTION_DAYS, daysAgo, nextOutboxState, outboxRetryDelayMs } from './notificationsPolicy.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'outbox' });

interface ClaimedEvent { event: OutboxEvent; leaseToken: string }

/** A short claim transaction prevents network waits from holding a DB
 * connection or row lock. The lease lets another instance retry after a crash. */
async function claimOutboxBatch(limit: number): Promise<ClaimedEvent[]> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const batch = await tx.select().from(outboxEvents)
      .where(and(isNull(outboxEvents.processedAt), lt(outboxEvents.attempts, OUTBOX_MAX_ATTEMPTS),
        lte(outboxEvents.nextAttemptAt, now), lt(outboxEvents.createdAt, new Date(now.getTime() - 1000)),
        or(isNull(outboxEvents.leaseUntil), lte(outboxEvents.leaseUntil, now))))
      .orderBy(outboxEvents.nextAttemptAt, outboxEvents.createdAt)
      .limit(limit)
      .for('update', { skipLocked: true });
    if (!batch.length) return [];
    const leaseToken = crypto.randomUUID();
    await tx.update(outboxEvents).set({ leaseToken, leaseUntil: new Date(now.getTime() + OUTBOX_LEASE_MS) })
      .where(inArray(outboxEvents.id, batch.map((event) => event.id)));
    return batch.map((event) => ({ event, leaseToken }));
  });
}

async function processClaim({ event, leaseToken }: ClaimedEvent): Promise<boolean> {
  let delivered = false;
  let retryAfterMs = 0;
  try {
    if (event.type !== 'chat_message_push') notifySocialChanged([event.audienceUserId]);
    const result = await deliverWebPush(event);
    delivered = result.delivered;
    retryAfterMs = result.retryAfterMs;
  } catch (err) {
    log.error('outbox delivery failed', err, { eventId: event.id, type: event.type });
  }
  const state = nextOutboxState(event.attempts, delivered);
  const now = new Date();
  const updated = await db.update(outboxEvents).set({
    attempts: state.attempts,
    processedAt: state.processed ? now : null,
    nextAttemptAt: state.processed ? now : new Date(now.getTime() + outboxRetryDelayMs(state.attempts, retryAfterMs)),
    leaseToken: null,
    leaseUntil: null,
  }).where(and(eq(outboxEvents.id, event.id), eq(outboxEvents.leaseToken, leaseToken)))
    .returning({ id: outboxEvents.id });
  if (!updated.length) log.warn('outbox lease changed before result was saved', { eventId: event.id });
  return updated.length > 0 && delivered;
}

let draining = false;
export async function drainOutbox(): Promise<{ processed: number; failed: number }> {
  if (draining) return { processed: 0, failed: 0 };
  draining = true;
  try {
    let processed = 0;
    let failed = 0;
    for (let remaining = OUTBOX_BATCH; remaining > 0;) {
      const claims = await claimOutboxBatch(Math.min(remaining, OUTBOX_CONCURRENCY));
      if (!claims.length) break;
      remaining -= claims.length;
      const outcomes = await Promise.allSettled(claims.map(processClaim));
      for (let index = 0; index < outcomes.length; index++) {
        const outcome = outcomes[index]!;
        if (outcome.status === 'rejected') log.error('outbox result could not be saved', outcome.reason, { eventId: claims[index]!.event.id });
        if (outcome.status === 'fulfilled' && outcome.value) processed++; else failed++;
      }
    }
    return { processed, failed };
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


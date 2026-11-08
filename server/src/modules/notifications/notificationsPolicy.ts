// Pure rules of the outbox worker. How long old rows are kept lives in modules/retention.

export const OUTBOX_MAX_ATTEMPTS = 8;
export const OUTBOX_BATCH = 50;
export const OUTBOX_CONCURRENCY = 4;
export const OUTBOX_POLL_MS = 2_000;
export const OUTBOX_LEASE_MS = 120_000;
const OUTBOX_RETRY_BASE_MS = 30_000;
const OUTBOX_RETRY_MAX_MS = 15 * 60_000;

export interface OutboxState { processed: boolean; attempts: number }

/** State of an outbox event after one delivery attempt. A failure only
 * increments the counter; the event stays unprocessed (and is picked up again)
 * until it runs out of attempts, after which it is left as "failed" — still
 * unprocessed, no longer retried, visible to an administrator. */
export function nextOutboxState(attempts: number, delivered: boolean): OutboxState {
  return { processed: delivered, attempts: attempts + 1 };
}

export function outboxRetryDelayMs(attempts: number, retryAfterMs = 0): number {
  const backoff = Math.min(OUTBOX_RETRY_MAX_MS, OUTBOX_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));
  return Math.max(backoff, retryAfterMs);
}

export const isOutboxFailed = (state: { processed: boolean; attempts: number }): boolean => !state.processed && state.attempts >= OUTBOX_MAX_ATTEMPTS;

/** Whether a push reaches this account at all. "Do not disturb" drops it for good, not until later:
 * the notification itself is still in the list, and a pile of stale pushes arriving the moment
 * someone turns it off would be the disturbance. */
export function recipientAcceptsPush(recipient: { status: string; presenceStatus: string }): boolean {
  return recipient.status === 'active' && recipient.presenceStatus !== 'dnd';
}

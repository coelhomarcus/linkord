import { and, eq, lte, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { connectionSyncLimits } from '../../db/schema.js';
import { ConnectionFetchError } from '../../integrations/connectionHttp.js';

// IGDB allows 4 requests per second per Client ID; leave room below that.
export const IGDB_REQUEST_INTERVAL_MS = 300;
const PROVIDER = 'igdb';
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Takes the next request slot of the whole deployment: PostgreSQL hands out one slot per interval, so
 * several instances together stay under the quota. Waits for a slot up to `maxWaitMs`, then gives up with
 * `rate_limited` and how long the next one is away, which the route turns into a Retry-After. */
export async function reserveIgdbSlot(maxWaitMs = 2000): Promise<void> {
  await db.insert(connectionSyncLimits).values({ provider: PROVIDER }).onConflictDoNothing();
  const deadline = Date.now() + maxWaitMs;
  while (true) {
    const [slot] = await db.update(connectionSyncLimits)
      .set({ nextRequestAt: sql`now() + ${IGDB_REQUEST_INTERVAL_MS} * interval '1 millisecond'` })
      .where(and(eq(connectionSyncLimits.provider, PROVIDER), lte(connectionSyncLimits.nextRequestAt, sql`now()`)))
      .returning({ provider: connectionSyncLimits.provider });
    if (slot) return;
    const [row] = await db.select({ waitMs: sql<number>`greatest(0, ceil(extract(epoch from (${connectionSyncLimits.nextRequestAt} - now())) * 1000))::int` })
      .from(connectionSyncLimits).where(eq(connectionSyncLimits.provider, PROVIDER));
    const wait = Math.max(25, row?.waitMs ?? IGDB_REQUEST_INTERVAL_MS);
    if (Date.now() + wait > deadline) throw new ConnectionFetchError('rate_limited', wait);
    await pause(wait);
  }
}

/** IGDB said 429: nobody sends to it until its cooldown (or at least a second) has passed. */
export async function postponeIgdb(ms: number): Promise<void> {
  const until = new Date(Date.now() + Math.max(ms, 1000));
  await db.insert(connectionSyncLimits).values({ provider: PROVIDER, nextRequestAt: until })
    .onConflictDoUpdate({ target: connectionSyncLimits.provider, set: { nextRequestAt: sql`greatest(${connectionSyncLimits.nextRequestAt}, ${until.toISOString()}::timestamptz)` } });
}

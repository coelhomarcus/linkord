import { asc, inArray } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { playgroundForgottenAccounts, playgroundSkins } from '../../db/schema.js';
import { signInternalRequest } from './playgroundToken.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'playground-sync' });

// What this server owes the playground service, kept in this database until the
// service took it, so a service that is down or redeploying only delays it:
//
// - accounts deleted here, whose skin and experience the service must drop
//   (queued by the deletion itself, in its transaction);
// - skins saved here before the service kept them (the old playground_skins
//   table), handed over once and then deleted here.
//
// Sent to PLAYGROUND_INTERNAL_URL under /playground/internal/, each request
// signed with PLAYGROUND_SECRET (playground/src/internal.ts).

const SYNC_INTERVAL_MS = 60_000;
const FIRST_SYNC_MS = 10_000;
const FORGET_BATCH = 500;
const SKIN_BATCH = 20;
const REQUEST_TIMEOUT_MS = 10_000;

type Executor = Pick<typeof db, 'insert'>;

/** Called in the transaction that deletes an account, so the two never part. Nothing to do while the
 * service is off: it has nothing of anyone. */
export async function queuePlaygroundForget(tx: Executor, userId: string): Promise<void> {
  if (!config.PLAYGROUND_INTERNAL_URL) return;
  await tx.insert(playgroundForgottenAccounts).values({ userId }).onConflictDoNothing();
}

export type PlaygroundPost = (route: 'forget' | 'import-skins', body: object) => Promise<void>;

async function post(route: string, body: object): Promise<void> {
  const text = JSON.stringify(body);
  const response = await fetch(`${config.PLAYGROUND_INTERNAL_URL}/playground/internal/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-playground-signature': signInternalRequest(text, config.PLAYGROUND_SECRET, Date.now()) },
    body: text,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`the playground service answered ${response.status}`);
}

/** Sends one batch of each; true while more is waiting. */
export async function syncPlayground(send: PlaygroundPost = post): Promise<boolean> {
  const forgotten = await db.select({ userId: playgroundForgottenAccounts.userId }).from(playgroundForgottenAccounts)
    .orderBy(asc(playgroundForgottenAccounts.queuedAt)).limit(FORGET_BATCH);
  if (forgotten.length > 0) {
    const userIds = forgotten.map((row) => row.userId);
    await send('forget', { userIds });
    await db.delete(playgroundForgottenAccounts).where(inArray(playgroundForgottenAccounts.userId, userIds));
    log.info('accounts forgotten in the playground', { count: userIds.length });
  }
  const skins = await db.select().from(playgroundSkins).orderBy(asc(playgroundSkins.userId)).limit(SKIN_BATCH);
  if (skins.length > 0) {
    await send('import-skins', { skins: skins.map((row) => ({ userId: row.userId, png: row.png, updatedAt: row.updatedAt.toISOString() })) });
    await db.delete(playgroundSkins).where(inArray(playgroundSkins.userId, skins.map((row) => row.userId)));
    log.info('skins handed to the playground', { count: skins.length });
  }
  return forgotten.length === FORGET_BATCH || skins.length === SKIN_BATCH;
}

/** Runs the sync every minute (and right away again while a batch was full), when the service is on. */
export function startPlaygroundSync(): NodeJS.Timeout | null {
  if (!config.PLAYGROUND_INTERNAL_URL) return null;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      while (await syncPlayground()) { /* the next batch */ }
    } catch (err) {
      // the rows stay; the next run sends them again
      log.warn('could not reach the playground service', { err: err instanceof Error ? err.message : String(err) });
    } finally {
      running = false;
    }
  };
  setTimeout(() => void run(), FIRST_SYNC_MS).unref();
  const timer = setInterval(() => void run(), SYNC_INTERVAL_MS);
  timer.unref();
  return timer;
}

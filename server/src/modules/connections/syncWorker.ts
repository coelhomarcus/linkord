import crypto from 'node:crypto';
import { and, eq, gt, inArray, isNull, lte, ne, notExists, or, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { connectionSyncLimits, profileConnections } from '../../db/schema.js';
import { ConnectionFetchError, fetchConnectionJson, fetchConnectionText, fetchSafeConnectionJson, type RequestJson, type RequestText } from '../../integrations/connectionHttp.js';
import { fetchSteam } from '../../integrations/steam/steamWebApi.js';
import { createTwitchClient, twitch } from '../../integrations/twitch/twitch.js';
import { fetchGitHub } from '../../integrations/github/github.js';
import { fetchMyAnimeList } from '../../integrations/myanimelist/myanimelist.js';
import { logger } from '../../lib/logger.js';
import { GITHUB_SYNC_INTERVAL_MS, PROVIDER_REQUEST_INTERVAL_MS, retryDelay, SYNC_INTERVAL_MS, SYNC_LEASE_MS } from './policy.js';

const log = logger.child({ component: 'connection-sync' });
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function reserveRequest(provider: string): Promise<void> {
  await db.insert(connectionSyncLimits).values({ provider }).onConflictDoNothing();
  while (true) {
    const [slot] = await db.update(connectionSyncLimits).set({ nextRequestAt: sql`now() + ${PROVIDER_REQUEST_INTERVAL_MS} * interval '1 millisecond'` })
      .where(and(eq(connectionSyncLimits.provider, provider), lte(connectionSyncLimits.nextRequestAt, sql`now()`))).returning({ provider: connectionSyncLimits.provider });
    if (slot) return;
    await pause(PROVIDER_REQUEST_INTERVAL_MS);
  }
}
async function claim(now: Date, providers: Array<'myanimelist' | 'github' | 'steam' | 'twitch'>) {
  return db.transaction(async (tx) => {
    await tx.insert(connectionSyncLimits).values({ provider: 'github', nextRequestAt: new Date(0) }).onConflictDoNothing();
    const [row] = await tx.select().from(profileConnections).where(and(inArray(profileConnections.provider, providers),
      notExists(tx.select().from(connectionSyncLimits).where(and(eq(connectionSyncLimits.provider, profileConnections.provider),
        or(and(eq(connectionSyncLimits.provider, 'github'), gt(connectionSyncLimits.nextRequestAt, now)),
          and(ne(connectionSyncLimits.provider, 'github'), gt(connectionSyncLimits.nextRequestAt, new Date(now.getTime() + 5000))))))),
      lte(profileConnections.nextSyncAt, now), or(isNull(profileConnections.leaseUntil), lte(profileConnections.leaseUntil, now))))
      .orderBy(profileConnections.nextSyncAt).limit(1).for('update', { skipLocked: true });
    if (!row) return null;
    if (row.provider === 'github') {
      const [slot] = await tx.update(connectionSyncLimits).set({ nextRequestAt: new Date(now.getTime() + GITHUB_SYNC_INTERVAL_MS) })
        .where(and(eq(connectionSyncLimits.provider, 'github'), lte(connectionSyncLimits.nextRequestAt, now))).returning({ provider: connectionSyncLimits.provider });
      if (!slot) return null;
    }
    const leaseToken = crypto.randomUUID();
    await tx.update(profileConnections).set({ leaseToken, leaseUntil: new Date(now.getTime() + SYNC_LEASE_MS) }).where(eq(profileConnections.id, row.id));
    return { ...row, leaseToken };
  });
}
interface SyncOptions {
  request?: RequestJson;
  requestText?: RequestText;
  now?: Date;
  malClientId?: string;
  steamKey?: string;
  twitchClient?: Pick<typeof twitch, 'profile' | 'configured'>;
  signal?: AbortSignal;
}

let running = false;
export async function syncConnections(options: SyncOptions = {}): Promise<void> {
  if (running) return;
  running = true;
  const steamKey = options.steamKey ?? config.STEAM_WEB_API_KEY;
  const twitchClient = options.twitchClient ?? (options.request ? createTwitchClient({ request: options.request }) : twitch);
  const providers: Array<'myanimelist' | 'github' | 'steam' | 'twitch'> = ['myanimelist', 'github'];
  if (steamKey) providers.push('steam');
  if (twitchClient.configured) providers.push('twitch');
  try {
    for (let count = 0; count < 20 && !options.signal?.aborted; count++) {
      const row = await claim(options.now ?? new Date(), providers);
      if (!row) break;
      const guard = and(eq(profileConnections.id, row.id), eq(profileConnections.leaseToken, row.leaseToken));
      try {
        const beforeRequest = async () => {
          if (row.provider !== 'github') await reserveRequest(row.provider);
          const renewed = await db.update(profileConnections).set({ leaseUntil: new Date(Date.now() + SYNC_LEASE_MS) }).where(guard).returning({ id: profileConnections.id });
          if (!renewed.length) throw new ConnectionFetchError('unavailable');
        };
        const request: RequestJson = options.request ?? (async (url, init) => {
          await beforeRequest();
          return fetchConnectionJson(url, init);
        });
        const requestText: RequestText = options.requestText ?? (async (url, init) => {
          await beforeRequest();
          return fetchConnectionText(url, init);
        });
        let snapshot;
        switch (row.provider) {
          case 'myanimelist': snapshot = await fetchMyAnimeList(row.value, request, options.malClientId ?? config.MAL_CLIENT_ID); break;
          case 'github': snapshot = await fetchGitHub(row.value, request, requestText); break;
          case 'steam': snapshot = (await fetchSteam(row.url, steamKey, options.request ?? (async (url, init) => {
            await beforeRequest();
            return fetchSafeConnectionJson(url, init);
          }), requestText)).snapshot; break;
          case 'twitch':
            await beforeRequest();
            snapshot = (await twitchClient.profile(row.value)).snapshot;
            break;
          default: throw new ConnectionFetchError('invalid_response');
        }
        const now = options.now ?? new Date();
        await db.update(profileConnections).set({ snapshot, syncedAt: now, syncError: null, attempts: 0,
          nextSyncAt: new Date(now.getTime() + SYNC_INTERVAL_MS), leaseToken: null, leaseUntil: null }).where(guard);
      } catch (error) {
        const failure = error instanceof ConnectionFetchError ? error : new ConnectionFetchError('unavailable');
        const now = options.now ?? new Date();
        if (failure.code === 'rate_limited') {
          const until = new Date(now.getTime() + retryDelay(row.attempts, failure.retryAfterMs));
          await db.insert(connectionSyncLimits).values({ provider: row.provider, nextRequestAt: until })
            .onConflictDoUpdate({ target: connectionSyncLimits.provider, set: { nextRequestAt: sql`greatest(${connectionSyncLimits.nextRequestAt}, ${until.toISOString()}::timestamptz)` } });
        }
        const delay = ['not_found', 'private', 'invalid_response'].includes(failure.code) ? SYNC_INTERVAL_MS : retryDelay(row.attempts, failure.retryAfterMs);
        await db.update(profileConnections).set({ syncError: failure.code, attempts: row.attempts + 1,
          nextSyncAt: new Date(now.getTime() + delay), leaseToken: null, leaseUntil: null }).where(guard);
        log.warn('connection sync failed', { connectionId: row.id, provider: row.provider, failure: failure.code });
      }
    }
  } finally { running = false; }
}

import { ConnectionFetchError } from '../../integrations/connectionHttp.js';
import type { IgdbClient } from '../../integrations/igdb/igdb.js';
import { allow, retryAfterMs } from '../../realtime/floodControl.js';
import { toGameItem } from './gameLists.js';
import type { GameItem } from './types.js';

const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 64;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;
// only a search that has to go to IGDB counts; a cached or shared one is free
const USER_RULE = { windowMs: 60_000, max: 20 };

export class GameSearchError extends Error {
  readonly status: 400 | 429 | 502 | 503;
  readonly code: 'invalid_request' | 'rate_limited' | 'games_unavailable' | 'games_search_failed';
  readonly retryAfterMs: number;
  constructor(status: GameSearchError['status'], code: GameSearchError['code'], retryAfterMs = 0) {
    super(code);
    this.status = status; this.code = code; this.retryAfterMs = retryAfterMs;
  }
}

/** The key a search is cached and shared under: the same letters, however they were typed. */
export function normalizeQuery(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const query = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return query.length >= MIN_QUERY_LENGTH && query.length <= MAX_QUERY_LENGTH ? query : null;
}

export interface GameSearchDeps {
  client: IgdbClient;
  /** The deployment-wide slot for one request to IGDB; rejects with `rate_limited` when none frees up soon. */
  reserve: () => Promise<void>;
  /** Called when IGDB itself answers 429. */
  postpone: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Searches IGDB for the Wall's game picker, protecting its 4 requests per second: results are cached
 * per normalized query, identical searches in flight share one request, each user has a budget of
 * requests that miss the cache, and a PostgreSQL slot paces the whole deployment. */
export function createGameSearch({ client, reserve, postpone, now = Date.now }: GameSearchDeps) {
  const cache = new Map<string, { games: GameItem[]; expiresAt: number }>();
  const inFlight = new Map<string, Promise<GameItem[]>>();

  async function fetchFromIgdb(query: string): Promise<GameItem[]> {
    try {
      await reserve();
      const games = (await client.searchGames(query)).map((game) => toGameItem(game, 'cover_small'));
      if (cache.size >= CACHE_MAX_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(query, { games, expiresAt: now() + CACHE_TTL_MS });
      return games;
    } catch (error) {
      if (error instanceof ConnectionFetchError && error.code === 'rate_limited') {
        await postpone(error.retryAfterMs).catch(() => undefined);
        throw new GameSearchError(429, 'rate_limited', error.retryAfterMs);
      }
      throw new GameSearchError(502, 'games_search_failed');
    }
  }

  return async function search(userId: string, raw: unknown): Promise<GameItem[]> {
    const query = normalizeQuery(raw);
    if (!query) throw new GameSearchError(400, 'invalid_request');
    if (!client.configured) throw new GameSearchError(503, 'games_unavailable');
    const hit = cache.get(query);
    if (hit && hit.expiresAt > now()) return hit.games;
    cache.delete(query);
    const pending = inFlight.get(query);
    if (pending) return pending;
    const key = `games-search:${userId}`;
    if (!allow(key, USER_RULE)) throw new GameSearchError(429, 'rate_limited', retryAfterMs(key, USER_RULE));
    const request = fetchFromIgdb(query).finally(() => inFlight.delete(query));
    inFlight.set(query, request);
    return request;
  };
}

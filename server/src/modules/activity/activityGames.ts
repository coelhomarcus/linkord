import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { activityGames } from '../../db/schema.js';
import { ConnectionFetchError } from '../../integrations/connectionHttp.js';
import type { IgdbClient } from '../../integrations/igdb/igdb.js';
import { allow, retryAfterMs } from '../../realtime/floodControl.js';
import { normalizeQuery } from '../games/gameSearch.js';
import type { GameSnapshot } from '../games/types.js';

// The name and cover a detected game shows with ("[cover] Jogando Dota 2"). The desktop app knows a
// Steam app id (from Steam) or a name (from its own catalog, or Steam's app manifest); IGDB turns
// that into its own name and cover. Every answer is kept in the database, since thousands of people
// open the same few games: IGDB is asked once per game, not once per person.

const FOUND_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// a game IGDB does not know may be added later, and a failure is retried sooner still
const MISSING_TTL_MS = 24 * 60 * 60 * 1000;
const USER_RULE = { windowMs: 60_000, max: 20 };

export interface ActivityGame {
  name: string;
  /** IGDB cover image id, or null */
  image: string | null;
}

export interface ActivityGameRow extends ActivityGame {
  resolvedAt: number;
}

export interface ActivityGameStore {
  get(key: string): Promise<ActivityGameRow | null>;
  set(key: string, value: ActivityGame, resolvedAt: number): Promise<void>;
}

const databaseActivityGameStore: ActivityGameStore = {
  async get(key) {
    const [row] = await db.select().from(activityGames).where(eq(activityGames.key, key)).limit(1);
    return row ? { name: row.name, image: row.imageId, resolvedAt: row.resolvedAt.getTime() } : null;
  },
  async set(key, value, resolvedAt) {
    const values = { key, name: value.name, imageId: value.image, resolvedAt: new Date(resolvedAt) };
    await db.insert(activityGames).values(values).onConflictDoUpdate({ target: activityGames.key, set: values });
  },
};

export class ActivityGameError extends Error {
  readonly status: 400 | 429;
  readonly code: 'invalid_request' | 'rate_limited';
  readonly retryAfterMs: number;
  constructor(status: ActivityGameError['status'], code: ActivityGameError['code'], retryAfterMs = 0) {
    super(code);
    this.status = status; this.code = code; this.retryAfterMs = retryAfterMs;
  }
}

/** The one game among the search results that has this name, else the first. */
export function pickByName(games: GameSnapshot[], name: string): GameSnapshot | null {
  const wanted = normalizeQuery(name);
  return games.find((game) => normalizeQuery(game.name) === wanted) ?? games[0] ?? null;
}

export function createActivityGameLookup(deps: {
  client: IgdbClient;
  reserve: () => Promise<void>;
  postpone: (ms: number) => Promise<void>;
  store?: ActivityGameStore;
  now?: () => number;
}) {
  const { client, reserve, postpone, store = databaseActivityGameStore, now = Date.now } = deps;
  const inFlight = new Map<string, Promise<ActivityGame>>();

  async function fromIgdb(steamAppId: number | null, name: string): Promise<GameSnapshot | null> {
    if (steamAppId) {
      await reserve();
      try {
        const game = await client.findSteamGame(steamAppId);
        if (game) return game;
      } catch (error) {
        if (error instanceof ConnectionFetchError && error.code === 'rate_limited') throw error;
        // a query IGDB refused: the name below may still find it
      }
    }
    const query = normalizeQuery(name);
    if (!query) return null;
    await reserve();
    return pickByName(await client.searchGames(query), name);
  }

  async function resolve(key: string, steamAppId: number | null, name: string): Promise<ActivityGame> {
    try {
      const game = await fromIgdb(steamAppId, name);
      const value = game ? { name: game.name, image: game.coverImageId } : { name, image: null };
      await store.set(key, value, now() - (game ? 0 : FOUND_TTL_MS - MISSING_TTL_MS));
      return value;
    } catch (error) {
      if (error instanceof ConnectionFetchError && error.code === 'rate_limited') await postpone(error.retryAfterMs).catch(() => undefined);
      // shown without a cover this time, and not remembered: the next person asks again
      return { name, image: null };
    }
  }

  /** The game for a Steam app id and/or a name: from the database when known, else from IGDB. */
  return async function lookup(userId: string, query: { steamAppId?: unknown; name?: unknown }): Promise<ActivityGame> {
    const steamAppId = typeof query.steamAppId === 'string' && /^\d{1,10}$/.test(query.steamAppId) ? Number(query.steamAppId) : null;
    const name = typeof query.name === 'string' ? query.name.replace(/\s+/g, ' ').trim().slice(0, 64) : '';
    const normalized = normalizeQuery(name);
    if (!steamAppId && !normalized) throw new ActivityGameError(400, 'invalid_request');
    const key = steamAppId ? `steam:${steamAppId}` : `name:${normalized}`;
    const cached = await store.get(key);
    if (cached && cached.resolvedAt + FOUND_TTL_MS > now()) return { name: cached.name, image: cached.image };
    if (!client.configured) return { name: cached?.name ?? name, image: cached?.image ?? null };
    const pending = inFlight.get(key);
    if (pending) return pending;
    const limitKey = `activity-game:${userId}`;
    if (!allow(limitKey, USER_RULE)) throw new ActivityGameError(429, 'rate_limited', retryAfterMs(limitKey, USER_RULE));
    const request = resolve(key, steamAppId, name || cached?.name || '').finally(() => inFlight.delete(key));
    inFlight.set(key, request);
    return request;
  };
}

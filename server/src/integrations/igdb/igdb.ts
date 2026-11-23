import type { GameSnapshot } from '../../modules/games/types.js';
import { ConnectionFetchError, numberValue, record, textValue } from '../connectionHttp.js';

import { createAppToken } from '../twitch/appToken.js';
const GAMES_URL = 'https://api.igdb.com/v4/games';
const IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 1024 * 1024;
// a result list only has to be recognized, and every result costs a cover to load
const SEARCH_LIMIT = 10;

/** Throws `ConnectionFetchError`: `unauthorized` (401), `rate_limited` (429, with the wait),
 * `unavailable` (anything else the service or the network does) or `invalid_response`. */
export type IgdbRequest = (url: string, init: RequestInit) => Promise<unknown>;

export type CoverSize = 'cover_small' | 'cover_big';
const IMAGE_ID = /^[a-z0-9]{1,40}$/;
const SLUG = /^[a-z0-9][a-z0-9_.-]{0,199}$/;
const MAX_NAME_LENGTH = 200;

export function isCoverImageId(value: unknown): value is string {
  return typeof value === 'string' && IMAGE_ID.test(value);
}
export function isGameSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG.test(value);
}
export function isGameName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= MAX_NAME_LENGTH;
}
/** Covers are built from a validated id on our own fixed host, never taken as a URL from the response. */
export function igdbCoverUrl(imageId: string, size: CoverSize): string {
  return `${IMAGE_BASE}/t_${size}/${imageId}.jpg`;
}
export function igdbGameUrl(slug: string): string {
  return `https://www.igdb.com/games/${slug}`;
}

export async function fetchIgdbJson(url: string, init: RequestInit, fetcher: typeof fetch = fetch): Promise<unknown> {
  try {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) {
      const retry = Number(response.headers.get('retry-after'));
      await response.body?.cancel();
      if (response.status === 401) throw new ConnectionFetchError('unauthorized');
      if (response.status === 429) throw new ConnectionFetchError('rate_limited', Number.isFinite(retry) && retry > 0 ? retry * 1000 : 0);
      throw new ConnectionFetchError('unavailable');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ConnectionFetchError('invalid_response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new ConnectionFetchError('invalid_response'); }
      chunks.push(chunk.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (error) {
    if (error instanceof ConnectionFetchError) throw error;
    throw new ConnectionFetchError(error instanceof SyntaxError ? 'invalid_response' : 'unavailable');
  }
}

function parseGame(value: unknown): GameSnapshot {
  const game = record(value);
  const id = numberValue(game.id);
  const name = textValue(game.name)?.trim().slice(0, MAX_NAME_LENGTH);
  if (id === null || !Number.isInteger(id) || id <= 0 || !name || !isGameSlug(game.slug)) throw new ConnectionFetchError('invalid_response');
  const cover = game.cover && typeof game.cover === 'object' && !Array.isArray(game.cover) ? (game.cover as Record<string, unknown>).image_id : null;
  const released = numberValue(game.first_release_date);
  return {
    igdbId: id, name, slug: game.slug,
    coverImageId: isCoverImageId(cover) ? cover : null,
    releaseYear: released === null ? null : new Date(released * 1000).getUTCFullYear(),
  };
}

/** A string for an Apicalypse `search "…"`: the quotes and backslashes are what could end it early. */
function quote(query: string): string {
  return `"${query.replace(/[\\"]/g, '\\$&')}"`;
}

export interface IgdbClient {
  /** false when the credentials are missing: nothing is requested and every search is `unavailable`. */
  readonly configured: boolean;
  searchGames(query: string): Promise<GameSnapshot[]>;
  /** The IGDB game listed for a Steam app id, or null (the activity of a Steam game, modules/activity). */
  findSteamGame(appId: number): Promise<GameSnapshot | null>;
}

/** IGDB signs requests with a Twitch app token. It is kept until it nears its expiry
 * and replaced when a request comes back 401, e.g. because Twitch revoked it. */
export function createIgdbClient(options: {
  clientId: string; clientSecret: string; request?: IgdbRequest; now?: () => number; appToken?: ReturnType<typeof createAppToken>;
}): IgdbClient {
  const { request = fetchIgdbJson } = options;
  const appToken = options.appToken ?? createAppToken({ ...options, request: (url, init) => request(url, init ?? {}) });

  async function queryGames(body: string): Promise<unknown[]> {
    const games = await appToken.authorize((headers) => request(GAMES_URL, { method: 'POST', headers, body }));
    if (!Array.isArray(games)) throw new ConnectionFetchError('invalid_response');
    return games;
  }

  return {
    configured: appToken.configured,
    async searchGames(query) {
      const games = await queryGames(`search ${quote(query)}; fields name,slug,first_release_date,cover.image_id; where version_parent = null; limit ${SEARCH_LIMIT};`);
      return games.slice(0, SEARCH_LIMIT).map(parseGame);
    },
    async findSteamGame(appId) {
      if (!Number.isSafeInteger(appId) || appId <= 0) return null;
      // external_game_source 1 is Steam; the uid is the app id as text
      const games = await queryGames(`fields name,slug,first_release_date,cover.image_id; where external_games.uid = "${appId}" & external_games.external_game_source = 1; limit 1;`);
      return games.length > 0 ? parseGame(games[0]) : null;
    },
  };
}

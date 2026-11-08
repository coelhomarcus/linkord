import type { GameSnapshot } from '../../modules/games/types.js';
import { ConnectionFetchError, numberValue, record, textValue } from '../connectionHttp.js';

const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const GAMES_URL = 'https://api.igdb.com/v4/games';
const IMAGE_BASE = 'https://images.igdb.com/igdb/image/upload';
const REQUEST_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 1024 * 1024;
// a token is replaced a little before it expires so a request never starts with a dying one
const TOKEN_MARGIN_MS = 60_000;
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
}

/** IGDB signs requests with a Twitch app token. It is kept until it nears its expiry
 * and replaced when a request comes back 401, e.g. because Twitch revoked it. */
export function createIgdbClient(options: { clientId: string; clientSecret: string; request?: IgdbRequest; now?: () => number }): IgdbClient {
  const { clientId, clientSecret, request = fetchIgdbJson, now = Date.now } = options;
  const configured = Boolean(clientId && clientSecret);
  let token: { value: string; expiresAt: number } | null = null;
  let renewal: Promise<string> | null = null;

  async function renew(): Promise<string> {
    const query = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' });
    let response: Record<string, unknown>;
    try {
      response = record(await request(`${TOKEN_URL}?${query}`, { method: 'POST' }));
    } catch (error) {
      // bad credentials answer 400/403, and a 401 here must not look like an expired token to the retry below
      if (error instanceof ConnectionFetchError && error.code === 'unauthorized') throw new ConnectionFetchError('unavailable');
      throw error;
    }
    const value = textValue(response.access_token);
    const seconds = numberValue(response.expires_in);
    if (!value || seconds === null) throw new ConnectionFetchError('invalid_response');
    token = { value, expiresAt: now() + seconds * 1000 - TOKEN_MARGIN_MS };
    return value;
  }
  function accessToken(): Promise<string> {
    if (token && token.expiresAt > now()) return Promise.resolve(token.value);
    // simultaneous searches wait for one token request instead of asking Twitch for one each
    renewal ??= renew().finally(() => { renewal = null; });
    return renewal;
  }

  return {
    configured,
    async searchGames(query) {
      if (!configured) throw new ConnectionFetchError('unavailable');
      const body = `search ${quote(query)}; fields name,slug,first_release_date,cover.image_id; where version_parent = null; limit ${SEARCH_LIMIT};`;
      for (let attempt = 0; ; attempt++) {
        const used = await accessToken();
        try {
          const games = await request(GAMES_URL, {
            method: 'POST',
            headers: { 'Client-ID': clientId, Authorization: `Bearer ${used}`, Accept: 'application/json' },
            body,
          });
          if (!Array.isArray(games)) throw new ConnectionFetchError('invalid_response');
          return games.slice(0, SEARCH_LIMIT).map(parseGame);
        } catch (error) {
          if (!(error instanceof ConnectionFetchError) || error.code !== 'unauthorized' || attempt > 0) throw error;
          if (token?.value === used) token = null;
        }
      }
    },
  };
}

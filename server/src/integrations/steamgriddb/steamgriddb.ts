import { ConnectionFetchError, fetchConnectionJson, imageUrl, list, numberValue, record, textValue, type RequestJson } from '../connectionHttp.js';

const API_BASE = 'https://www.steamgriddb.com/api/v2';
export const STEAMGRIDDB_IMAGE_HOST = 'cdn2.steamgriddb.com';
const ARTWORK_FILTERS = { types: 'static', nsfw: 'false', humor: 'false', epilepsy: 'false' };
const ICON_FILTERS = new URLSearchParams(ARTWORK_FILTERS).toString();
const BANNER_DIMENSIONS = ['460x215', '920x430'];
const BANNER_FILTERS = new URLSearchParams({ ...ARTWORK_FILTERS, dimensions: BANNER_DIMENSIONS.join(',') }).toString();
const SEARCH_LIMIT = 10;
const STEAM_HASH = /^[0-9a-f]{40}$/;

interface SteamAppAssets {
  appId: number;
  /** hash of the Steam client's .ico for the game (up to 256 px), or null */
  clientIcon: string | null;
  /** hash of the 32 px community icon, or null */
  icon: string | null;
}

export interface GridGame {
  id: number;
  name: string;
  /** seconds, as SteamGridDB gives it, or null */
  releaseDate: number | null;
  /** only from the lookups that ask for it (steamGame, gameById); null when the game is not on Steam */
  steam: SteamAppAssets | null;
}

export interface GridIcon {
  /** the full picture, on STEAMGRIDDB_IMAGE_HOST: a PNG, or an .ico the server cannot read */
  url: string;
  /** a PNG copy, up to 512 px, when SteamGridDB has one, else null */
  thumb: string | null;
  style: string | null;
}

export interface SteamGridDbClient {
  /** false without an API key: nothing is requested. */
  readonly configured: boolean;
  /** The game listed for a Steam app id, with that app's assets; null when SteamGridDB does not know it. */
  steamGame(appId: number): Promise<GridGame | null>;
  /** A game by SteamGridDB id, with its Steam assets when it is on Steam. */
  gameById(gameId: number): Promise<GridGame | null>;
  searchGames(term: string): Promise<GridGame[]>;
  gameIcons(gameId: number): Promise<GridIcon[]>;
  steamBanners(appId: number): Promise<string[]>;
}

/** The `data` of a `{ success, data }` answer. */
function data(value: unknown): unknown {
  const body = record(value);
  if (body.success !== true) throw new ConnectionFetchError('invalid_response');
  return body.data;
}

function steamHash(value: unknown): string | null {
  return typeof value === 'string' && STEAM_HASH.test(value) ? value : null;
}

/** The Steam entry for `appId` (else the first one) of a game's `external_platform_data`. */
function parseSteam(value: unknown, appId: number | null): SteamAppAssets | null {
  if (!value || typeof value !== 'object') return null;
  const entries = (value as Record<string, unknown>).steam;
  if (!Array.isArray(entries)) return null;
  const parsed = entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const { id, metadata } = entry as Record<string, unknown>;
    const app = typeof id === 'string' && /^\d{1,10}$/.test(id) ? Number(id) : null;
    if (!app) return [];
    const meta = metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {};
    return [{ appId: app, clientIcon: steamHash(meta.clienticon), icon: steamHash(meta.icon) }];
  });
  return parsed.find((entry) => entry.appId === appId) ?? parsed[0] ?? null;
}

function parseGame(value: unknown, appId: number | null = null): GridGame | null {
  if (!value || typeof value !== 'object') return null;
  const game = value as Record<string, unknown>;
  const id = numberValue(game.id);
  const name = textValue(game.name);
  if (id === null || !Number.isSafeInteger(id) || id <= 0 || !name) return null;
  return { id, name, releaseDate: numberValue(game.release_date), steam: parseSteam(game.external_platform_data, appId) };
}

function parseIcons(value: unknown): GridIcon[] {
  const icons: GridIcon[] = [];
  for (const item of list(value)) {
    if (!item || typeof item !== 'object') continue;
    const icon = item as Record<string, unknown>;
    // the filters were asked for; a picture that does not say it meets them is skipped anyway
    if (icon.nsfw === true || icon.humor === true || icon.epilepsy === true) continue;
    const url = imageUrl(icon.url, STEAMGRIDDB_IMAGE_HOST);
    if (!url) continue;
    icons.push({ url, thumb: imageUrl(icon.thumb, STEAMGRIDDB_IMAGE_HOST), style: textValue(icon.style) });
  }
  return icons;
}

function parseBanners(value: unknown): string[] {
  const banners = new Set<string>();
  for (const item of list(value)) {
    if (!item || typeof item !== 'object') continue;
    const { url, width, height, nsfw, humor, epilepsy } = item as Record<string, unknown>;
    if (nsfw === true || humor === true || epilepsy === true) continue;
    if (typeof width !== 'number' || typeof height !== 'number' || !BANNER_DIMENSIONS.includes(`${width}x${height}`)) continue;
    const banner = imageUrl(url, STEAMGRIDDB_IMAGE_HOST);
    if (banner && !new URL(banner).port) banners.add(banner);
  }
  return [...banners];
}

export function createSteamGridDbClient(options: { apiKey: string; request?: RequestJson }): SteamGridDbClient {
  const { apiKey, request = fetchConnectionJson } = options;
  const configured = Boolean(apiKey);

  async function get(path: string): Promise<unknown> {
    if (!configured) throw new ConnectionFetchError('unavailable');
    return data(await request(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }));
  }

  /** What SteamGridDB does not have answers 404, which is an answer, not a failure. */
  async function orNotFound<T>(read: () => Promise<T>, missing: T): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof ConnectionFetchError && error.code === 'not_found') return missing;
      throw error;
    }
  }

  const validId = (id: number) => Number.isSafeInteger(id) && id > 0;

  return {
    configured,
    async steamGame(appId) {
      if (!validId(appId)) return null;
      return orNotFound(async () => parseGame(await get(`/games/steam/${appId}?platformdata=steam`), appId), null);
    },
    async gameById(gameId) {
      if (!validId(gameId)) return null;
      return orNotFound(async () => parseGame(await get(`/games/id/${gameId}?platformdata=steam`)), null);
    },
    async searchGames(term) {
      const query = term.trim();
      if (!query) return [];
      return orNotFound(async () => {
        const games = list(await get(`/search/autocomplete/${encodeURIComponent(query)}`)).map((item) => parseGame(item));
        return games.filter((game): game is GridGame => game !== null).slice(0, SEARCH_LIMIT);
      }, []);
    },
    async gameIcons(gameId) {
      if (!validId(gameId)) return [];
      return orNotFound(async () => parseIcons(await get(`/icons/game/${gameId}?${ICON_FILTERS}`)), []);
    },
    async steamBanners(appId) {
      if (!validId(appId)) return [];
      return orNotFound(async () => parseBanners(await get(`/grids/steam/${appId}?${BANNER_FILTERS}`)), []);
    },
  };
}

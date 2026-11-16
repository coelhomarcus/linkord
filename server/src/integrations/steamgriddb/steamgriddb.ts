import { ConnectionFetchError, fetchConnectionJson, imageUrl, list, numberValue, record, textValue, type RequestJson } from '../connectionHttp.js';

// SteamGridDB: community-made artwork for games, the only source of a real square icon for most of
// them (IGDB has covers and artworks, never an icon; Steam's own icons are 32 px). Used for the icon
// of a game someone is playing (modules/activity/activityGameIcons.ts).

const API_BASE = 'https://www.steamgriddb.com/api/v2';
export const STEAMGRIDDB_IMAGE_HOST = 'cdn2.steamgriddb.com';
// still pictures only, and nothing a profile should not show by surprise. Not filtered by type: most
// icons are .ico files, and each of those comes with a PNG thumb (512 px), which is what is read.
const ICON_FILTERS = new URLSearchParams({ types: 'static', nsfw: 'false', humor: 'false', epilepsy: 'false' }).toString();
const SEARCH_LIMIT = 10;

export interface GridGame {
  id: number;
  name: string;
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
  /** Icons for a Steam app id, best first; [] when SteamGridDB does not know the game. */
  steamIcons(appId: number): Promise<GridIcon[]>;
  searchGames(term: string): Promise<GridGame[]>;
  gameIcons(gameId: number): Promise<GridIcon[]>;
}

/** The `data` of a `{ success, data }` answer. */
function data(value: unknown): unknown {
  const body = record(value);
  if (body.success !== true) throw new ConnectionFetchError('invalid_response');
  return body.data;
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

function parseGames(value: unknown): GridGame[] {
  const games: GridGame[] = [];
  for (const item of list(value)) {
    if (!item || typeof item !== 'object') continue;
    const game = item as Record<string, unknown>;
    const id = numberValue(game.id);
    const name = textValue(game.name);
    if (id !== null && Number.isSafeInteger(id) && id > 0 && name) games.push({ id, name });
  }
  return games.slice(0, SEARCH_LIMIT);
}

export function createSteamGridDbClient(options: { apiKey: string; request?: RequestJson }): SteamGridDbClient {
  const { apiKey, request = fetchConnectionJson } = options;
  const configured = Boolean(apiKey);

  async function get(path: string): Promise<unknown> {
    if (!configured) throw new ConnectionFetchError('unavailable');
    return data(await request(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } }));
  }

  /** A game SteamGridDB does not have answers 404, which is an answer, not a failure. */
  async function icons(path: string): Promise<GridIcon[]> {
    try {
      return parseIcons(await get(`${path}?${ICON_FILTERS}`));
    } catch (error) {
      if (error instanceof ConnectionFetchError && error.code === 'not_found') return [];
      throw error;
    }
  }

  return {
    configured,
    steamIcons(appId) {
      if (!Number.isSafeInteger(appId) || appId <= 0) return Promise.resolve([]);
      return icons(`/icons/steam/${appId}`);
    },
    async searchGames(term) {
      const query = term.trim();
      if (!query) return [];
      try {
        return parseGames(await get(`/search/autocomplete/${encodeURIComponent(query)}`));
      } catch (error) {
        if (error instanceof ConnectionFetchError && error.code === 'not_found') return [];
        throw error;
      }
    },
    gameIcons(gameId) {
      if (!Number.isSafeInteger(gameId) || gameId <= 0) return Promise.resolve([]);
      return icons(`/icons/game/${gameId}`);
    },
  };
}

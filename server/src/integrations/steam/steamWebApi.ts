import { ConnectionFetchError, fetchSafeConnectionJson, list, record, textValue, type RequestJson } from '../connectionHttp.js';
import type { ConnectionSnapshot, SteamGame } from '../../modules/connections/types.js';
import { STEAM_ASSET_HOST } from './steamAssets.js';

export const STEAM_IMAGE_HOSTS = [STEAM_ASSET_HOST, 'avatars.steamstatic.com', 'avatars.akamai.steamstatic.com',
  'avatars.fastly.steamstatic.com', 'avatars.cloudflare.steamstatic.com', 'steamcdn-a.akamaihd.net'] as const;
const BASE = 'https://api.steampowered.com';
const VANITY = /^[a-z0-9_-]{2,64}$/i;

function isSteamId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{17}$/.test(value)
    && BigInt(value) > 76561197960265728n && BigInt(value) <= 76561202255233023n;
}

export function parseSteamProfile(input: string): { value: string; id: string | null; url: string } | null {
  let value = input;
  let path: string | undefined;
  if (input.includes('/')) {
    try {
      const url = new URL(input);
      if (!['https:', 'http:'].includes(url.protocol) || !['steamcommunity.com', 'www.steamcommunity.com'].includes(url.hostname)
        || url.port || url.username || url.password) return null;
      const match = /^\/(id|profiles)\/([a-z0-9_-]+)\/?$/i.exec(url.pathname);
      if (!match) return null;
      path = match[1]!.toLowerCase();
      value = match[2]!;
    } catch { return null; }
  }
  const id = path !== 'id' && isSteamId(value) ? value : null;
  if (!id && (path === 'profiles' || !VANITY.test(value) || (!path && /^\d{17}$/.test(value)))) return null;
  return { value, id, url: `https://steamcommunity.com/${id ? 'profiles' : 'id'}/${value}` };
}

const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function avatarUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && (STEAM_IMAGE_HOSTS as readonly string[]).includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

function games(value: Record<string, unknown>, minutesKey: string): SteamGame[] {
  if (value.games === undefined && (value.game_count === 0 || value.total_count === 0)) return [];
  return list(value.games).flatMap((item) => {
    const row = record(item);
    const minutes = row[minutesKey];
    if (!integer(row.appid) || row.appid === 0 || !integer(minutes)) throw new ConnectionFetchError('invalid_response');
    const name = textValue(row.name);
    if (!name) return []; // a removed or unlisted title can still be in the library count
    return [{
      id: String(row.appid), title: name, minutes, url: `https://store.steampowered.com/app/${row.appid}/`,
      imageUrl: `https://${STEAM_ASSET_HOST}/store_item_assets/steam/apps/${row.appid}/header.jpg`,
    }];
  });
}

export async function fetchSteam(value: string, key: string, request: RequestJson = fetchSafeConnectionJson):
  Promise<{ snapshot: ConnectionSnapshot; url: string }> {
  if (!key) throw new ConnectionFetchError('unavailable');
  const input = parseSteamProfile(value);
  if (!input) throw new ConnectionFetchError('not_found');
  const get = async (endpoint: string, params: Record<string, string>) =>
    record(await request(`${BASE}/${endpoint}/?${new URLSearchParams({ ...params, key })}`));
  let steamId = input.id;
  if (!steamId) {
    // A numeric vanity URL is distinct from a bare SteamID64.
    const result = record((await get('ISteamUser/ResolveVanityURL/v1', { vanityurl: input.value })).response);
    if (result.success === 42) throw new ConnectionFetchError('not_found');
    if (result.success !== 1 || !isSteamId(result.steamid)) throw new ConnectionFetchError('invalid_response');
    steamId = result.steamid;
  }
  const players = list(record((await get('ISteamUser/GetPlayerSummaries/v2', { steamids: steamId })).response).players);
  if (!players.length) throw new ConnectionFetchError('not_found');
  const profile = record(players[0]);
  if (profile.steamid !== steamId || !integer(profile.communityvisibilitystate)) throw new ConnectionFetchError('invalid_response');
  if (profile.communityvisibilitystate !== 3) throw new ConnectionFetchError('private');
  const name = textValue(profile.personaname);
  if (!name) throw new ConnectionFetchError('invalid_response');
  const owned = record((await get('IPlayerService/GetOwnedGames/v1', { steamid: steamId, include_appinfo: '1', include_played_free_games: '1' })).response);
  if (Object.keys(owned).length === 0) throw new ConnectionFetchError('private');
  if (!integer(owned.game_count)) throw new ConnectionFetchError('invalid_response');
  const top = games(owned, 'playtime_forever').filter((item) => item.minutes > 0).sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  const [recent, level] = await Promise.all([
    get('IPlayerService/GetRecentlyPlayedGames/v1', { steamid: steamId, count: '8' }),
    get('IPlayerService/GetSteamLevel/v1', { steamid: steamId }),
  ]);
  const { player_level: playerLevel } = record(level.response);
  if (!integer(playerLevel)) throw new ConnectionFetchError('invalid_response');
  return {
    url: `https://steamcommunity.com/profiles/${steamId}`,
    snapshot: { widgets: {
      'steam-profile': { kind: 'steam-profile', name, avatarUrl: avatarUrl(profile.avatarfull), level: playerLevel,
        owned: owned.game_count, currentGame: textValue(profile.gameextrainfo) },
      'steam-top': { kind: 'steam-games', items: top },
      'steam-recent': { kind: 'steam-games', items: games(record(recent.response), 'playtime_2weeks').slice(0, 8) },
    } },
  };
}

import { ConnectionFetchError, fetchConnectionText, fetchSafeConnectionJson, list, record, textValue, type RequestJson, type RequestText } from '../connectionHttp.js';
import type { ConnectionSnapshot, SteamGame } from '../../modules/connections/types.js';
import { STEAM_ASSET_HOST } from './steamAssets.js';
import { readSteamPublicProfile } from './steamPublicProfile.js';

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

function gameTimes(value: Record<string, unknown>, publicIds: Set<number>) {
  if (!integer(value.game_count)) throw new ConnectionFetchError('invalid_response');
  const matches = new Map<number, { game: SteamGame; recentMinutes: number }>();
  if (value.games === undefined && value.game_count === 0) return matches;
  for (const item of list(value.games)) {
    const row = record(item);
    if (!integer(row.appid) || row.appid === 0) throw new ConnectionFetchError('invalid_response');
    if (!publicIds.has(row.appid)) continue;
    const minutes = row.playtime_forever;
    const recentMinutes = row.playtime_2weeks ?? 0;
    if (!integer(minutes) || !integer(recentMinutes)) throw new ConnectionFetchError('invalid_response');
    const name = textValue(row.name);
    if (!name) continue; // a removed or unlisted title can still be in the library count
    matches.set(row.appid, { recentMinutes, game: {
      id: String(row.appid), title: name, minutes, url: `https://store.steampowered.com/app/${row.appid}/`,
      imageUrl: `https://${STEAM_ASSET_HOST}/store_item_assets/steam/apps/${row.appid}/header.jpg`,
    } });
  }
  return matches;
}

export async function fetchSteam(value: string, key: string, request: RequestJson = fetchSafeConnectionJson, requestText: RequestText = fetchConnectionText):
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
  const url = `https://steamcommunity.com/profiles/${steamId}`;
  // Steam redirects numeric profile URLs to their vanity URL when one exists.
  const profileAddress = typeof profile.profileurl === 'string' ? parseSteamProfile(profile.profileurl) : null;
  const vanity = profileAddress?.id === null ? profileAddress : null;
  const profileUrl = vanity?.url ?? url;
  const { owned, currentGame, recentIds } = readSteamPublicProfile(await requestText(`${profileUrl}/?l=english`), steamId, profileUrl);
  const [ownedGames, level] = await Promise.all([
    recentIds.size ? get('IPlayerService/GetOwnedGames/v1', { input_json: JSON.stringify({
      steamid: steamId, include_appinfo: true, include_played_free_games: true, include_family_licenses: true, appids_filter: [...recentIds],
    }) }) : null,
    get('IPlayerService/GetSteamLevel/v1', { steamid: steamId }),
  ]);
  const { player_level: playerLevel } = record(level.response);
  if (!integer(playerLevel)) throw new ConnectionFetchError('invalid_response');
  const visibleGames: ReturnType<typeof gameTimes> = ownedGames ? gameTimes(record(ownedGames.response), recentIds) : new Map();
  const recent = [...recentIds].flatMap((id) => {
    const match = visibleGames.get(id);
    return match && match.recentMinutes > 0 ? [{ ...match.game, minutes: match.recentMinutes }] : [];
  }).slice(0, 8);
  const top = [...visibleGames.values()].map(({ game }) => game).filter((game) => game.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes).slice(0, 8);
  return {
    url,
    snapshot: { steamVisibilityVerified: true, ...(vanity && { steamProfileHandle: vanity.value }), widgets: {
      'steam-profile': { kind: 'steam-profile', name, avatarUrl: avatarUrl(profile.avatarfull), level: playerLevel, owned, currentGame },
      'steam-top': { kind: 'steam-games', items: top },
      'steam-recent': { kind: 'steam-games', items: recent },
    } },
  };
}

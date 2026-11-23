import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RequestJson } from '../../../src/integrations/connectionHttp.js';
import { fetchSteam, parseSteamProfile } from '../../../src/integrations/steam/steamWebApi.js';

const id = '76561197960287930';
const game = (appid: number, name: string, playtime_forever: number) => ({ appid, name, playtime_forever });
const player = { steamid: id, communityvisibilitystate: 3, personaname: 'Example', avatarfull: 'https://avatars.fastly.steamstatic.com/example.jpg' };
function api(overrides: Record<string, unknown> = {}): RequestJson {
  const data = {
    ResolveVanityURL: { success: 1, steamid: id },
    GetPlayerSummaries: { players: [player] },
    GetOwnedGames: { game_count: 3, games: [game(10, 'First', 30), game(20, 'Second', 121), game(30, 'Third', 0)] },
    GetRecentlyPlayedGames: { total_count: 1, games: [{ ...game(20, 'Second', 121), playtime_2weeks: 61 }] },
    GetSteamLevel: { player_level: 47 },
    ...overrides,
  } as Record<string, unknown>;
  return async (url) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://api.steampowered.com');
    assert.equal(target.searchParams.get('key'), 'test-key');
    const method = target.pathname.split('/')[2]!;
    assert.ok(Object.hasOwn(data, method));
    if (method === 'GetPlayerSummaries') assert.equal(target.searchParams.get('steamids'), id);
    return { response: data[method] };
  };
}

test('accepts a SteamID64, a vanity name and Steam profile URLs only', () => {
  assert.equal(parseSteamProfile(id)?.id, id);
  assert.equal(parseSteamProfile(`https://steamcommunity.com/profiles/${id}/`)?.id, id);
  assert.equal(parseSteamProfile('example')?.url, 'https://steamcommunity.com/id/example');
  assert.equal(parseSteamProfile('https://www.steamcommunity.com/id/example/?l=english')?.value, 'example');
  assert.equal(parseSteamProfile(`https://steamcommunity.com/id/${id}`)?.id, null);
  for (const value of ['https://example.com/id/example', 'https://steamcommunity.com/groups/example', 'https://x@steamcommunity.com/id/example', '76561299999999999']) {
    assert.equal(parseSteamProfile(value), null);
  }
});

test('resolves a vanity name and builds public widgets with separate recent and lifetime minutes', async () => {
  const result = await fetchSteam('example', 'test-key', api());
  assert.equal(result.url, `https://steamcommunity.com/profiles/${id}`);
  const widgets = result.snapshot.widgets;
  assert.deepEqual(widgets['steam-profile'], { kind: 'steam-profile', name: 'Example', avatarUrl: player.avatarfull, currentGame: null, owned: 3, level: 47 });
  const top = widgets['steam-top'];
  assert.equal(top?.kind, 'steam-games');
  assert.deepEqual(top.items.map(({ title, minutes }) => [title, minutes]), [['Second', 121], ['First', 30]]);
  const recent = widgets['steam-recent'];
  assert.equal(recent?.kind, 'steam-games');
  assert.deepEqual(recent.items.map(({ minutes }) => minutes), [61]);
});

test('distinguishes private profiles and game details from unknown accounts and malformed data', async () => {
  await assert.rejects(fetchSteam(id, 'test-key', api({ GetPlayerSummaries: { players: [{ ...player, communityvisibilitystate: 1 }] } })), { code: 'private' });
  await assert.rejects(fetchSteam(id, 'test-key', api({ GetOwnedGames: {} })), { code: 'private' });
  await assert.rejects(fetchSteam('missing', 'test-key', api({ ResolveVanityURL: { success: 42 } })), { code: 'not_found' });
  await assert.rejects(fetchSteam(id, 'test-key', api({ GetOwnedGames: { game_count: 1, games: [game(20, 'Bad', -2)] } })), { code: 'invalid_response' });
  const empty = await fetchSteam(id, 'test-key', api({ GetOwnedGames: { game_count: 0 }, GetRecentlyPlayedGames: { total_count: 0 } }));
  assert.deepEqual(empty.snapshot.widgets['steam-top'], { kind: 'steam-games', items: [] });
});

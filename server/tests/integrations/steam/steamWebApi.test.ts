import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RequestJson, RequestText } from '../../../src/integrations/connectionHttp.js';
import { fetchSteam, parseSteamProfile } from '../../../src/integrations/steam/steamWebApi.js';

const id = '76561197960287930';
const canonicalUrl = `https://steamcommunity.com/profiles/${id}`;
const game = (appid: number, name: string, playtime_forever: number, playtime_2weeks = 0) => ({ appid, name, playtime_forever, playtime_2weeks });
const player = { steamid: id, communityvisibilitystate: 3, personaname: 'Example', avatarfull: 'https://avatars.fastly.steamstatic.com/example.jpg' };
const visibleGame = (id: number, hours = '2 hrs on record') => `<div class="recent_game">
  <div class="game_info_details">${hours}</div><div class="game_name"><a href="https://steamcommunity.com/app/${id}">Game</a></div>
</div>`;
function publicProfile({ url = canonicalUrl, count = '3', status = '', recent = visibleGame(10) + visibleGame(20) } = {}): RequestText {
  return async (target, init) => {
    assert.equal(target, `${url}/?l=english`);
    assert.equal(init, undefined);
    return `<script>g_rgProfileData = {"steamid":"${id}"};</script><div class="profile_rightcol">${status}
      <div class="profile_count_link"><a href="${url}/games/?tab=all"><span class="profile_count_link_total">${count}</span></a></div>
    </div><div class="recent_games">${recent}</div>`;
  };
}

function api(overrides: Record<string, unknown> = {}, publicIds = [10, 20]): RequestJson {
  const data = {
    ResolveVanityURL: { success: 1, steamid: id },
    GetPlayerSummaries: { players: [player] },
    GetOwnedGames: { game_count: 2, games: [game(10, 'First', 30), game(20, 'Second', 121, 61)] },
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
    if (method === 'GetOwnedGames') {
      assert.ok(publicIds.length);
      const { steamid, appids_filter } = JSON.parse(target.searchParams.get('input_json')!);
      assert.equal(steamid, id);
      assert.deepEqual(appids_filter, publicIds);
    }
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
  const url = 'https://steamcommunity.com/id/example';
  const result = await fetchSteam('example', 'test-key', api({ GetPlayerSummaries: { players: [{ ...player, profileurl: `${url}/` }] } }), publicProfile({ url }));
  assert.equal(result.url, canonicalUrl);
  const widgets = result.snapshot.widgets;
  assert.deepEqual(widgets['steam-profile'], { kind: 'steam-profile', name: 'Example', avatarUrl: player.avatarfull, currentGame: null, owned: 3, level: 47 });
  const top = widgets['steam-top'];
  assert.equal(top?.kind, 'steam-games');
  assert.deepEqual(top.items.map(({ title, minutes }) => [title, minutes]), [['Second', 121], ['First', 30]]);
  const recent = widgets['steam-recent'];
  assert.equal(recent?.kind, 'steam-games');
  assert.deepEqual(recent.items.map(({ minutes }) => minutes), [61]);
});

test('omits private games and their playtime even when the Web API returns them', async () => {
  const result = await fetchSteam(id, 'test-key', api({
    GetPlayerSummaries: { players: [{ ...player, gameextrainfo: 'Private game', gameid: '30' }] },
    GetOwnedGames: { game_count: 4, games: [game(30, 'Private game', 800, 400), game(40, 'Private playtime', 500, 300), game(20, 'Public game', 121, 61)] },
  }, [20]), publicProfile({ count: '1,022', recent: visibleGame(20) + visibleGame(40, 'Last played today') }));
  const widgets = result.snapshot.widgets;
  assert.deepEqual(widgets['steam-profile'], { kind: 'steam-profile', name: 'Example', avatarUrl: player.avatarfull, currentGame: null, owned: 1022, level: 47 });
  for (const [type, minutes] of [['steam-top', 121], ['steam-recent', 61]] as const) {
    const widget = widgets[type];
    assert.equal(widget?.kind, 'steam-games');
    assert.deepEqual(widget.items.map(({ title, minutes }) => [title, minutes]), [['Public game', minutes]]);
  }
});

test('uses the public in-game status and skips the game API when there are no public recent titles', async () => {
  const status = '<div class="profile_in_game persona in-game"><div class="profile_in_game_name">Public &amp; playing</div></div>';
  const result = await fetchSteam(id, 'test-key', api({}, []), publicProfile({ recent: '', status }));
  const profile = result.snapshot.widgets['steam-profile'];
  assert.equal(profile?.kind, 'steam-profile');
  assert.equal(profile.currentGame, 'Public & playing');
  assert.deepEqual(result.snapshot.widgets['steam-recent'], { kind: 'steam-games', items: [] });
});

test('distinguishes private profiles and game details from unknown accounts and malformed data', async () => {
  const noPage: RequestText = async () => assert.fail('The profile page should not be requested');
  await assert.rejects(fetchSteam(id, 'test-key', api({ GetPlayerSummaries: { players: [{ ...player, communityvisibilitystate: 1 }] } }), noPage), { code: 'private' });
  await assert.rejects(fetchSteam(id, 'test-key', api(), async () => `<script>g_rgProfileData = {"steamid":"${id}"};</script><div class="profile_rightcol"></div>`), { code: 'private' });
  await assert.rejects(fetchSteam('missing', 'test-key', api({ ResolveVanityURL: { success: 42 } }), noPage), { code: 'not_found' });
  await assert.rejects(fetchSteam(id, 'test-key', api(), async () => '<html>Unexpected page</html>'), { code: 'invalid_response' });
  await assert.rejects(fetchSteam(id, 'test-key', api({ GetOwnedGames: { game_count: 1, games: [game(20, 'Bad', -2)] } }), publicProfile()), { code: 'invalid_response' });
  const empty = await fetchSteam(id, 'test-key', api({}, []), publicProfile({ count: '0', recent: '' }));
  assert.deepEqual(empty.snapshot.widgets['steam-top'], { kind: 'steam-games', items: [] });
});

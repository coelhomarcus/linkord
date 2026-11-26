import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConnectionFetchError, type RequestJson } from '../../../src/integrations/connectionHttp.js';
import { createIgdbClient } from '../../../src/integrations/igdb/igdb.js';
import { createAppToken } from '../../../src/integrations/twitch/appToken.js';
import { createTwitchClient, parseTwitchLogin } from '../../../src/integrations/twitch/twitch.js';

const user = { id: '310', login: 'example', display_name: 'Example', profile_image_url: 'https://static-cdn.jtvnw.net/avatar.jpg',
  offline_image_url: 'https://static-cdn.jtvnw.net/offline-1920x1080.png' };
const video = { id: '510', title: 'Replay', created_at: '2026-11-23T14:00:00Z', duration: '1h2m3s', thumbnail_url: 'https://static-cdn.jtvnw.net/vod-%{width}x%{height}.jpg' };
const live = { user_login: 'example', type: 'live', title: 'Hello!', game_name: 'Overcord', viewer_count: 42, thumbnail_url: 'https://static-cdn.jtvnw.net/live-{width}x{height}.jpg' };

function fixtures() {
  let now = 0;
  let tokenRequests = 0;
  let streamRequests = 0;
  let streams: unknown[] = [live];
  const request: RequestJson = async (url, init) => {
    const target = new URL(url);
    if (target.hostname === 'id.twitch.tv') return { access_token: `token-${++tokenRequests}`, expires_in: 3600 };
    assert.equal(init?.headers && new Headers(init.headers).get('client-id'), 'app');
    if (target.pathname === '/v4/games') return [];
    assert.equal(target.origin, 'https://api.twitch.tv');
    if (target.pathname === '/helix/users') return { data: target.searchParams.get('login') === user.login ? [user] : [] };
    if (target.pathname === '/helix/videos') {
      assert.equal(target.searchParams.get('user_id'), user.id);
      assert.equal(target.searchParams.get('type'), 'archive');
      assert.equal(target.searchParams.get('first'), '6');
      return { data: [video] };
    }
    streamRequests++;
    assert.equal(target.searchParams.get('user_login'), user.login);
    return { data: streams };
  };
  const appToken = createAppToken({ clientId: 'app', clientSecret: 'test', request, now: () => now });
  return {
    twitch: createTwitchClient({ appToken, request, now: () => now }), appToken, request,
    setStreams: (value: unknown[]) => { streams = value; },
    advance: (ms: number) => { now += ms; },
    counts: () => [tokenRequests, streamRequests],
  };
}

test('Twitch normalizes a login, validates the account, and parses its archived streams', async () => {
  assert.equal(parseTwitchLogin('Example'), 'example');
  assert.equal(parseTwitchLogin('https://twitch.tv/example'), null);
  const { twitch } = fixtures();
  const result = await twitch.profile('example');
  assert.equal(result.url, 'https://www.twitch.tv/example');
  const vods = result.snapshot.widgets['twitch-vods'];
  assert.equal(vods?.kind, 'twitch-vods');
  assert.deepEqual(vods.items, [{ id: '510', title: 'Replay', createdAt: '2026-11-23T14:00:00.000Z', seconds: 3723,
    imageUrl: 'https://static-cdn.jtvnw.net/vod-640x360.jpg', url: 'https://www.twitch.tv/videos/510' }]);
  const channel = result.snapshot.widgets['twitch-live'];
  assert.equal(channel?.kind === 'twitch-live' && channel.offlineImageUrl, 'https://static-cdn.jtvnw.net/offline-1920x1080.png');
  await assert.rejects(twitch.profile('unknown'), { code: 'not_found' });
});

test('live reads share a short cache, can become offline, and reject malformed responses', async () => {
  const { twitch, setStreams, advance, counts } = fixtures();
  const first = twitch.live('example');
  assert.equal(twitch.live('example'), first);
  assert.deepEqual(await first, { title: 'Hello!', game: 'Overcord', viewers: 42, imageUrl: 'https://static-cdn.jtvnw.net/live-640x360.jpg' });
  setStreams([]);
  advance(60_001);
  assert.equal(await twitch.live('example'), null);
  setStreams([{ ...live, viewer_count: -1 }]);
  advance(60_001);
  await assert.rejects(twitch.live('example'), { code: 'invalid_response' });
  assert.deepEqual(counts(), [1, 3]);
});

test('IGDB and Twitch share one renewal and retry once after a 401', async () => {
  const { twitch, appToken, request, counts } = fixtures();
  const igdb = createIgdbClient({ clientId: 'app', clientSecret: 'test', appToken, request: async (url, init) => {
    if (new Headers(init.headers).get('authorization') === 'Bearer token-1') throw new ConnectionFetchError('unauthorized');
    return request(url, init);
  } });
  await Promise.all([twitch.profile('example'), igdb.searchGames('a'), igdb.searchGames('b')]);
  assert.deepEqual(counts(), [2, 0]);
  await assert.rejects(appToken.authorize(async () => { throw new ConnectionFetchError('unauthorized'); }), { code: 'unauthorized' });
  assert.deepEqual(counts(), [3, 0]);
});

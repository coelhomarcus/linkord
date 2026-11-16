import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConnectionFetchError, type RequestJson } from '../../../src/integrations/connectionHttp.js';
import { createSteamGridDbClient } from '../../../src/integrations/steamgriddb/steamgriddb.js';

const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);
const icon = (id: string, extra: Record<string, unknown> = {}) => ({
  id: 1, score: 0, style: 'official', width: 256, height: 256, nsfw: false, humor: false, epilepsy: false, mime: 'image/png',
  url: `https://cdn2.steamgriddb.com/icon/${id}.png`, thumb: `https://cdn2.steamgriddb.com/icon_thumb/${id}.png`, ...extra,
});
const eldenRing = {
  id: 5277816, name: 'Elden Ring', release_date: 1642723200, types: ['steam'], verified: true,
  external_platform_data: { steam: [{ id: '1245620', metadata: { clienticon: HASH_A, icon: HASH_B, header_image: 'english' } }] },
};

function fake(answer: (url: string) => unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request: RequestJson = async (url, init) => {
    calls.push({ url, init });
    const value = answer(url);
    if (value instanceof Error) throw value;
    return value;
  };
  return { request, calls };
}

describe('SteamGridDB adapter', () => {
  it('finds the game of a Steam app id with Steam\'s icon hashes, using the API key', async () => {
    const api = fake(() => ({ success: true, data: eldenRing }));
    const client = createSteamGridDbClient({ apiKey: 'key-1', request: api.request });
    assert.deepEqual(await client.steamGame(1245620), {
      id: 5277816, name: 'Elden Ring', releaseDate: 1642723200, steam: { appId: 1245620, clientIcon: HASH_A, icon: HASH_B },
    });
    assert.equal(api.calls[0]!.url, 'https://www.steamgriddb.com/api/v2/games/steam/1245620?platformdata=steam');
    assert.deepEqual(api.calls[0]!.init?.headers, { Authorization: 'Bearer key-1', Accept: 'application/json' });
  });

  it('reads a game outside Steam, and refuses hashes that are not hashes', async () => {
    const api = fake((url) => ({ success: true, data: url.includes('/36136') ? { id: 36136, name: 'Fortnite', external_platform_data: {} } : { ...eldenRing, external_platform_data: { steam: [{ id: '1245620', metadata: { clienticon: '../x', icon: null } }] } } }));
    const client = createSteamGridDbClient({ apiKey: 'k', request: api.request });
    assert.deepEqual(await client.gameById(36136), { id: 36136, name: 'Fortnite', releaseDate: null, steam: null });
    assert.deepEqual((await client.gameById(5277816))?.steam, { appId: 1245620, clientIcon: null, icon: null });
    assert.equal(api.calls[0]!.url, 'https://www.steamgriddb.com/api/v2/games/id/36136?platformdata=steam');
  });

  it('asks for the still, safe icons of a game', async () => {
    const api = fake(() => ({ success: true, data: [icon('aaa')] }));
    const client = createSteamGridDbClient({ apiKey: 'k', request: api.request });
    assert.deepEqual(await client.gameIcons(7), [{ url: 'https://cdn2.steamgriddb.com/icon/aaa.png', thumb: 'https://cdn2.steamgriddb.com/icon_thumb/aaa.png', style: 'official' }]);
    const url = new URL(api.calls[0]!.url);
    assert.equal(`${url.origin}${url.pathname}`, 'https://www.steamgriddb.com/api/v2/icons/game/7');
    assert.deepEqual(Object.fromEntries(url.searchParams), { types: 'static', nsfw: 'false', humor: 'false', epilepsy: 'false' });
  });

  it('drops pictures off the image host or flagged anyway', async () => {
    const api = fake(() => ({ success: true, data: [icon('a', { url: 'https://evil.example/a.png' }), icon('b', { nsfw: true }), icon('c', { thumb: 'http://cdn2.steamgriddb.com/x.png' })] }));
    const client = createSteamGridDbClient({ apiKey: 'k', request: api.request });
    assert.deepEqual(await client.gameIcons(7), [{ url: 'https://cdn2.steamgriddb.com/icon/c.png', thumb: null, style: 'official' }]);
  });

  it('searches a name, encoded in the path, keeping games with an id and a name', async () => {
    const api = fake(() => ({ success: true, data: [{ id: 5, name: 'Fortnite', release_date: 1500940800 }, { id: -1, name: 'x' }, { id: 6 }] }));
    const client = createSteamGridDbClient({ apiKey: 'k', request: api.request });
    assert.deepEqual(await client.searchGames('Tom Clancy\'s / Siege'), [{ id: 5, name: 'Fortnite', releaseDate: 1500940800, steam: null }]);
    assert.equal(api.calls[0]!.url, 'https://www.steamgriddb.com/api/v2/search/autocomplete/Tom%20Clancy\'s%20%2F%20Siege');
  });

  it('treats an unknown game as none and passes on other failures', async () => {
    const missing = createSteamGridDbClient({ apiKey: 'k', request: fake(() => new ConnectionFetchError('not_found')).request });
    assert.equal(await missing.steamGame(1), null);
    assert.deepEqual(await missing.gameIcons(1), []);
    const limited = createSteamGridDbClient({ apiKey: 'k', request: fake(() => new ConnectionFetchError('rate_limited', 1000)).request });
    await assert.rejects(limited.steamGame(1), (error) => error instanceof ConnectionFetchError && error.code === 'rate_limited');
    const broken = createSteamGridDbClient({ apiKey: 'k', request: fake(() => ({ success: false, errors: ['nope'] })).request });
    await assert.rejects(broken.gameIcons(1), (error) => error instanceof ConnectionFetchError && error.code === 'invalid_response');
  });

  it('asks nothing without a key or for a bad id', async () => {
    const api = fake(() => ({ success: true, data: [] }));
    assert.equal(createSteamGridDbClient({ apiKey: '', request: api.request }).configured, false);
    await assert.rejects(createSteamGridDbClient({ apiKey: '', request: api.request }).gameIcons(1));
    assert.equal(await createSteamGridDbClient({ apiKey: 'k', request: api.request }).steamGame(0), null);
    assert.equal(api.calls.length, 0);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConnectionFetchError, type RequestJson } from '../../../src/integrations/connectionHttp.js';
import { createSteamGridDbClient } from '../../../src/integrations/steamgriddb/steamgriddb.js';

const icon = (id: string, extra: Record<string, unknown> = {}) => ({
  id: 1, score: 0, style: 'official', width: 256, height: 256, nsfw: false, humor: false, epilepsy: false, mime: 'image/png',
  url: `https://cdn2.steamgriddb.com/icon/${id}.png`, thumb: `https://cdn2.steamgriddb.com/icon_thumb/${id}.png`, ...extra,
});

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
  it('asks for the still, safe icons of a Steam app id with the API key', async () => {
    const api = fake(() => ({ success: true, data: [icon('aaa')] }));
    const client = createSteamGridDbClient({ apiKey: 'key-1', request: api.request });
    assert.deepEqual(await client.steamIcons(570), [{ url: 'https://cdn2.steamgriddb.com/icon/aaa.png', thumb: 'https://cdn2.steamgriddb.com/icon_thumb/aaa.png', style: 'official' }]);
    const url = new URL(api.calls[0]!.url);
    assert.equal(`${url.origin}${url.pathname}`, 'https://www.steamgriddb.com/api/v2/icons/steam/570');
    assert.deepEqual(Object.fromEntries(url.searchParams), { types: 'static', nsfw: 'false', humor: 'false', epilepsy: 'false' });
    assert.deepEqual(api.calls[0]!.init?.headers, { Authorization: 'Bearer key-1', Accept: 'application/json' });
  });

  it('drops pictures off the image host or flagged anyway', async () => {
    const api = fake(() => ({ success: true, data: [icon('a', { url: 'https://evil.example/a.png' }), icon('b', { nsfw: true }), icon('c', { thumb: 'http://cdn2.steamgriddb.com/x.png' })] }));
    const client = createSteamGridDbClient({ apiKey: 'k', request: api.request });
    assert.deepEqual(await client.gameIcons(7), [{ url: 'https://cdn2.steamgriddb.com/icon/c.png', thumb: null, style: 'official' }]);
  });

  it('searches a name, encoded in the path, and keeps games with an id and a name', async () => {
    const api = fake(() => ({ success: true, data: [{ id: 5, name: 'Fortnite' }, { id: -1, name: 'x' }, { id: 6 }] }));
    const client = createSteamGridDbClient({ apiKey: 'k', request: api.request });
    assert.deepEqual(await client.searchGames('Tom Clancy\'s / Siege'), [{ id: 5, name: 'Fortnite' }]);
    assert.equal(api.calls[0]!.url, 'https://www.steamgriddb.com/api/v2/search/autocomplete/Tom%20Clancy\'s%20%2F%20Siege');
  });

  it('treats an unknown game as no icons and passes on other failures', async () => {
    const missing = createSteamGridDbClient({ apiKey: 'k', request: fake(() => new ConnectionFetchError('not_found')).request });
    assert.deepEqual(await missing.steamIcons(1), []);
    const limited = createSteamGridDbClient({ apiKey: 'k', request: fake(() => new ConnectionFetchError('rate_limited', 1000)).request });
    await assert.rejects(limited.steamIcons(1), (error) => error instanceof ConnectionFetchError && error.code === 'rate_limited');
    const broken = createSteamGridDbClient({ apiKey: 'k', request: fake(() => ({ success: false, errors: ['nope'] })).request });
    await assert.rejects(broken.gameIcons(1), (error) => error instanceof ConnectionFetchError && error.code === 'invalid_response');
  });

  it('asks nothing without a key or for a bad id', async () => {
    const api = fake(() => ({ success: true, data: [] }));
    assert.equal(createSteamGridDbClient({ apiKey: '', request: api.request }).configured, false);
    await assert.rejects(createSteamGridDbClient({ apiKey: '', request: api.request }).steamIcons(1));
    assert.deepEqual(await createSteamGridDbClient({ apiKey: 'k', request: api.request }).steamIcons(0), []);
    assert.equal(api.calls.length, 0);
  });
});

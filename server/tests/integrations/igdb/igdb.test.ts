import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConnectionFetchError } from '../../../src/integrations/connectionHttp.js';
import { createIgdbClient, fetchIgdbJson, igdbCoverUrl, igdbGameUrl, type IgdbRequest } from '../../../src/integrations/igdb/igdb.js';

const TOKEN = { access_token: 'token-1', expires_in: 5_000_000, token_type: 'bearer' };
const zelda = { id: 1022, name: 'The Legend of Zelda', slug: 'the-legend-of-zelda', first_release_date: 530_841_600, cover: { image_id: 'co1abc' } };

/** Answers the token and games URLs like the real services would, and records every call. */
function fakeIgdb(games: (call: number) => unknown, token: (call: number) => unknown = () => TOKEN) {
  const calls: { url: string; init: RequestInit }[] = [];
  let tokenCalls = 0; let gameCalls = 0;
  const request: IgdbRequest = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('https://id.twitch.tv/')) { const value = token(++tokenCalls); if (value instanceof Error) throw value; return value; }
    const value = games(++gameCalls);
    if (value instanceof Error) throw value;
    return value;
  };
  return { request, calls, tokens: () => calls.filter((call) => call.url.startsWith('https://id.twitch.tv/')), games: () => calls.filter((call) => call.url.startsWith('https://api.igdb.com/')) };
}

describe('IGDB adapter', () => {
  it('searches with the app token, the client ID and a narrow Apicalypse query', async () => {
    const fake = fakeIgdb(() => [zelda]);
    const client = createIgdbClient({ clientId: 'id', clientSecret: 'secret', request: fake.request });
    const games = await client.searchGames('zelda');
    assert.deepEqual(games, [{ igdbId: 1022, name: 'The Legend of Zelda', slug: 'the-legend-of-zelda', coverImageId: 'co1abc', releaseYear: 1986 }]);
    const token = new URL(fake.tokens()[0]!.url);
    assert.equal(token.searchParams.get('grant_type'), 'client_credentials');
    assert.equal(token.searchParams.get('client_id'), 'id');
    assert.equal(token.searchParams.get('client_secret'), 'secret');
    assert.equal(fake.tokens()[0]!.init.method, 'POST');
    const call = fake.games()[0]!;
    assert.equal(call.url, 'https://api.igdb.com/v4/games');
    assert.deepEqual(call.init.headers, { 'Client-ID': 'id', Authorization: 'Bearer token-1', Accept: 'application/json' });
    assert.equal(call.init.body, 'search "zelda"; fields name,slug,first_release_date,cover.image_id; where version_parent = null; limit 10;');
  });
  it('escapes quotes and backslashes so a query cannot add statements', async () => {
    const fake = fakeIgdb(() => []);
    await createIgdbClient({ clientId: 'id', clientSecret: 's', request: fake.request }).searchGames('a"; limit 500; \\');
    assert.equal(fake.games()[0]!.init.body, 'search "a\\"; limit 500; \\\\"; fields name,slug,first_release_date,cover.image_id; where version_parent = null; limit 10;');
  });
  it('keeps the token until it nears its expiry, then asks for another', async () => {
    let clock = 0;
    const fake = fakeIgdb(() => [], () => ({ ...TOKEN, expires_in: 3600 }));
    const client = createIgdbClient({ clientId: 'id', clientSecret: 's', request: fake.request, now: () => clock });
    await client.searchGames('one'); await client.searchGames('two');
    assert.equal(fake.tokens().length, 1);
    clock = 3600 * 1000 - 61_000; await client.searchGames('three');
    assert.equal(fake.tokens().length, 1);
    clock = 3600 * 1000 - 59_000; await client.searchGames('four');
    assert.equal(fake.tokens().length, 2);
  });
  it('asks Twitch for one token when searches start together', async () => {
    const fake = fakeIgdb(() => []);
    const client = createIgdbClient({ clientId: 'id', clientSecret: 's', request: fake.request });
    await Promise.all([client.searchGames('one'), client.searchGames('two'), client.searchGames('three')]);
    assert.equal(fake.tokens().length, 1);
  });
  it('renews the token once on a 401 and retries the search', async () => {
    const fake = fakeIgdb((call) => (call === 1 ? new ConnectionFetchError('unauthorized') : [zelda]), (call) => ({ ...TOKEN, access_token: `token-${call}` }));
    const games = await createIgdbClient({ clientId: 'id', clientSecret: 's', request: fake.request }).searchGames('zelda');
    assert.equal(games.length, 1);
    assert.deepEqual(fake.games().map((call) => (call.init.headers as Record<string, string>).Authorization), ['Bearer token-1', 'Bearer token-2']);
  });
  it('gives up after the renewed token is refused too', async () => {
    const fake = fakeIgdb(() => new ConnectionFetchError('unauthorized'));
    await assert.rejects(createIgdbClient({ clientId: 'id', clientSecret: 's', request: fake.request }).searchGames('zelda'), (error: ConnectionFetchError) => error.code === 'unauthorized');
    assert.equal(fake.games().length, 2);
  });
  it('reports bad credentials as unavailable, not as an expired token', async () => {
    const fake = fakeIgdb(() => [], () => new ConnectionFetchError('unauthorized'));
    await assert.rejects(createIgdbClient({ clientId: 'id', clientSecret: 'bad', request: fake.request }).searchGames('zelda'), (error: ConnectionFetchError) => error.code === 'unavailable');
    assert.equal(fake.games().length, 0);
  });
  it('passes IGDB rate limiting on with its wait', async () => {
    const fake = fakeIgdb(() => new ConnectionFetchError('rate_limited', 3000));
    await assert.rejects(createIgdbClient({ clientId: 'id', clientSecret: 's', request: fake.request }).searchGames('zelda'),
      (error: ConnectionFetchError) => error.code === 'rate_limited' && error.retryAfterMs === 3000);
    assert.equal(fake.tokens().length, 1);
  });
  it('rejects payloads that are not a list of games instead of guessing', async () => {
    for (const payload of [{ message: 'oops' }, [{ id: 1 }], [{ id: 1, name: 'No slug' }], [{ id: 'x', name: 'Bad id', slug: 'bad' }], [{ id: 1, name: 'Bad slug', slug: '../x' }], ['text']]) {
      const fake = fakeIgdb(() => payload);
      await assert.rejects(createIgdbClient({ clientId: 'id', clientSecret: 's', request: fake.request }).searchGames('x'), (error: ConnectionFetchError) => error.code === 'invalid_response');
    }
    const noToken = fakeIgdb(() => [], () => ({ token_type: 'bearer' }));
    await assert.rejects(createIgdbClient({ clientId: 'id', clientSecret: 's', request: noToken.request }).searchGames('x'), (error: ConnectionFetchError) => error.code === 'invalid_response');
  });
  it('drops a cover id that is not a plain image id and tolerates a missing cover or date', async () => {
    const fake = fakeIgdb(() => [
      { ...zelda, id: 1, cover: { image_id: 'https://evil.example/x' } },
      { ...zelda, id: 2, cover: { image_id: '../../x' } },
      { id: 3, name: 'Bare', slug: 'bare' },
    ]);
    const games = await createIgdbClient({ clientId: 'id', clientSecret: 's', request: fake.request }).searchGames('x');
    assert.deepEqual(games.map((game) => game.coverImageId), [null, null, null]);
    assert.equal(games[2]!.releaseYear, null);
  });
  it('is unavailable without credentials and makes no request', async () => {
    const fake = fakeIgdb(() => assert.fail('must not request'));
    for (const [id, secret] of [['', ''], ['id', ''], ['', 's']] as const) {
      const client = createIgdbClient({ clientId: id, clientSecret: secret, request: fake.request });
      assert.equal(client.configured, false);
      await assert.rejects(client.searchGames('zelda'), (error: ConnectionFetchError) => error.code === 'unavailable');
    }
    assert.equal(fake.calls.length, 0);
  });
  it('builds cover and game links on the fixed IGDB hosts', () => {
    assert.equal(igdbCoverUrl('co1abc', 'cover_small'), 'https://images.igdb.com/igdb/image/upload/t_cover_small/co1abc.jpg');
    assert.equal(igdbCoverUrl('co1abc', 'cover_big'), 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg');
    assert.equal(igdbGameUrl('the-legend-of-zelda'), 'https://www.igdb.com/games/the-legend-of-zelda');
  });
});

describe('IGDB HTTP', () => {
  const answer = (status: number, body = '[]', headers: Record<string, string> = {}) => (async () => new Response(body, { status, headers })) as typeof fetch;
  it('maps statuses to the errors the client reacts to', async () => {
    await assert.rejects(fetchIgdbJson('https://x', {}, answer(401)), (e: ConnectionFetchError) => e.code === 'unauthorized');
    await assert.rejects(fetchIgdbJson('https://x', {}, answer(429, '', { 'retry-after': '2' })), (e: ConnectionFetchError) => e.code === 'rate_limited' && e.retryAfterMs === 2000);
    await assert.rejects(fetchIgdbJson('https://x', {}, answer(429)), (e: ConnectionFetchError) => e.code === 'rate_limited' && e.retryAfterMs === 0);
    for (const status of [400, 403, 500, 503]) await assert.rejects(fetchIgdbJson('https://x', {}, answer(status)), (e: ConnectionFetchError) => e.code === 'unavailable');
    await assert.rejects(fetchIgdbJson('https://x', {}, (async () => { throw new TypeError('network'); }) as typeof fetch), (e: ConnectionFetchError) => e.code === 'unavailable');
    await assert.rejects(fetchIgdbJson('https://x', {}, answer(200, 'not json')), (e: ConnectionFetchError) => e.code === 'invalid_response');
    assert.deepEqual(await fetchIgdbJson('https://x', {}, answer(200, '[1]')), [1]);
  });
  it('refuses redirects and oversized bodies', async () => {
    let redirect: string | undefined;
    await fetchIgdbJson('https://x', {}, (async (_url: unknown, init?: RequestInit) => { redirect = init?.redirect; return new Response('[]'); }) as typeof fetch);
    assert.equal(redirect, 'error');
    await assert.rejects(fetchIgdbJson('https://x', {}, answer(200, 'x'.repeat(1024 * 1024 + 1))), (e: ConnectionFetchError) => e.code === 'invalid_response');
  });
});

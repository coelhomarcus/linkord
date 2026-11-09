import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ConnectionFetchError } from '../../../src/integrations/connectionHttp.js';
import type { IgdbClient } from '../../../src/integrations/igdb/igdb.js';
import { createGameSearch, GameSearchError, MAX_QUERY_LENGTH, normalizeQuery } from '../../../src/modules/games/gameSearch.js';
import type { GameSnapshot } from '../../../src/modules/games/types.js';

const game = (igdbId: number, name = `Game ${igdbId}`): GameSnapshot => ({ igdbId, name, slug: `game-${igdbId}`, coverImageId: 'co1abc', releaseYear: 2000 });

function setup(options: { configured?: boolean; search?: (query: string) => Promise<GameSnapshot[]>; reserve?: () => Promise<void>; now?: () => number } = {}) {
  const searched: string[] = []; const postponed: number[] = []; let reserved = 0;
  const client: IgdbClient = {
    configured: options.configured ?? true,
    async searchGames(query) { searched.push(query); return options.search ? options.search(query) : [game(1)]; },
  };
  const search = createGameSearch({
    client, now: options.now,
    reserve: async () => { reserved++; await options.reserve?.(); },
    postpone: async (ms) => { postponed.push(ms); },
  });
  return { search, searched, postponed, reserved: () => reserved };
}
const failsWith = (status: number, code: string) => (error: unknown) => error instanceof GameSearchError && error.status === status && error.code === code;
// the per-user budget is shared by every test through the process-wide limiter, so each test is its own user
let userCounter = 0; let user: string;
beforeEach(() => { user = `searcher-${++userCounter}`; });

describe('game search query', () => {
  it('lowercases, collapses spaces and drops control characters', () => {
    assert.equal(normalizeQuery('  The   Legend\tof ZELDA  '), 'the legend of zelda');
    assert.equal(normalizeQuery('zel\u0000da'), 'zel da');
  });
  it('rejects anything shorter than two characters or longer than the maximum', () => {
    for (const query of [undefined, null, 42, '', ' ', 'a', ' a ', 'x'.repeat(MAX_QUERY_LENGTH + 1)]) assert.equal(normalizeQuery(query), null);
    assert.equal(normalizeQuery('go'), 'go');
    assert.equal(normalizeQuery('x'.repeat(MAX_QUERY_LENGTH)), 'x'.repeat(MAX_QUERY_LENGTH));
  });
});

describe('game search', () => {
  it('turns games into items with links built on our side and a small cover', async () => {
    const { search } = setup();
    assert.deepEqual(await search(user, 'zelda'), [{ ...game(1), url: 'https://www.igdb.com/games/game-1', imageUrl: '/api/media-proxy/igdb/cover_small/co1abc' }]);
  });
  it('rejects a short query without asking IGDB or spending a slot', async () => {
    const { search, searched, reserved } = setup();
    await assert.rejects(search(user, 'a'), failsWith(400, 'invalid_request'));
    await assert.rejects(search(user, undefined), failsWith(400, 'invalid_request'));
    assert.deepEqual(searched, []); assert.equal(reserved(), 0);
  });
  it('answers unavailable without credentials, before anything else is spent', async () => {
    const { search, searched, reserved } = setup({ configured: false });
    await assert.rejects(search(user, 'zelda'), failsWith(503, 'games_unavailable'));
    assert.deepEqual(searched, []); assert.equal(reserved(), 0);
  });
  it('serves a repeated search, typed differently, from the cache', async () => {
    const { search, searched } = setup();
    const first = await search(user, 'Zelda');
    assert.deepEqual(await search(user, '  zelda '), first);
    assert.deepEqual(searched, ['zelda']);
  });
  it('expires cached results after their time to live', async () => {
    let clock = 0;
    const { search, searched } = setup({ now: () => clock });
    await search(user, 'zelda'); clock = 6 * 60 * 60 * 1000 - 1; await search(user, 'zelda');
    assert.equal(searched.length, 1);
    clock = 6 * 60 * 60 * 1000 + 1; await search(user, 'zelda');
    assert.equal(searched.length, 2);
  });
  it('keeps the cache bounded by dropping the oldest entry', async () => {
    const { search, searched } = setup();
    for (let i = 0; i < 501; i++) await search(`${user}-${i}`, `query ${i}`);
    searched.length = 0;
    await search(user, 'query 0'); assert.deepEqual(searched, ['query 0']);
    searched.length = 0;
    await search(user, 'query 500'); assert.deepEqual(searched, []);
  });
  it('shares one request between identical searches in flight, from different people', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { search, searched, reserved } = setup({ search: async () => { await gate; return [game(7)]; } });
    const all = Promise.all([search(user, 'zelda'), search(`${user}-b`, 'ZELDA'), search(`${user}-c`, 'zelda ')]);
    await new Promise((resolve) => setImmediate(resolve));
    release();
    const results = await all;
    assert.deepEqual(searched, ['zelda']); assert.equal(reserved(), 1);
    assert.ok(results.every((result) => result[0]?.igdbId === 7));
  });
  it('limits how many searches that reach IGDB one person can make, and cache hits do not count', async () => {
    const { search, searched } = setup();
    for (let i = 0; i < 20; i++) await search(user, `query ${i}`);
    for (let i = 0; i < 50; i++) await search(user, 'query 0');
    await assert.rejects(search(user, 'one more'), (error: unknown) => failsWith(429, 'rate_limited')(error) && (error as GameSearchError).retryAfterMs > 0);
    assert.equal(searched.length, 20);
    assert.equal((await search(`${user}-other`, 'one more')).length, 1);
  });
  it('does not charge the person who only joined a search in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { search } = setup({ search: async () => { await gate; return []; } });
    const pending = Promise.all(Array.from({ length: 5 }, (_, i) => search(`${user}-${i}`, 'shared')));
    await new Promise((resolve) => setImmediate(resolve));
    release(); await pending;
    // a joiner still has its whole budget
    for (let i = 0; i < 20; i++) await search(`${user}-1`, `own ${i}`);
  });
  it('maps IGDB rate limiting to 429 and pushes the shared cooldown back, without caching', async () => {
    let limited = true;
    const { search, postponed, searched } = setup({ search: async () => { if (limited) throw new ConnectionFetchError('rate_limited', 4000); return [game(2)]; } });
    await assert.rejects(search(user, 'zelda'), (error: unknown) => failsWith(429, 'rate_limited')(error) && (error as GameSearchError).retryAfterMs === 4000);
    assert.deepEqual(postponed, [4000]);
    limited = false;
    assert.equal((await search(user, 'zelda'))[0]?.igdbId, 2);
    assert.equal(searched.length, 2);
  });
  it('lets the global limiter refuse a search, and reports how long to wait', async () => {
    const { search, searched } = setup({ reserve: async () => { throw new ConnectionFetchError('rate_limited', 250); } });
    await assert.rejects(search(user, 'zelda'), (error: unknown) => failsWith(429, 'rate_limited')(error) && (error as GameSearchError).retryAfterMs === 250);
    assert.deepEqual(searched, []);
  });
  it('maps every other failure of the service to 502 and never caches it', async () => {
    for (const code of ['unavailable', 'invalid_response', 'unauthorized']) {
      let broken = true;
      const { search, searched } = setup({ search: async () => { if (broken) throw new ConnectionFetchError(code); return []; } });
      await assert.rejects(search(user + code, 'zelda'), failsWith(502, 'games_search_failed'));
      broken = false;
      await search(user + code, 'zelda');
      assert.equal(searched.length, 2);
    }
  });
});

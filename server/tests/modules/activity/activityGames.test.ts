import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionFetchError } from '../../../src/integrations/connectionHttp.js';
import type { IgdbClient } from '../../../src/integrations/igdb/igdb.js';
import { ActivityGameError, createActivityGameLookup, parseActivityGameQuery, pickByName, type ActivityGameStore, type ActivityGameRow } from '../../../src/modules/activity/activityGames.js';
import type { GameSnapshot } from '../../../src/modules/games/types.js';

const game = (name: string, cover: string | null = 'co1'): GameSnapshot => ({ igdbId: 1, name, slug: name.toLowerCase().replace(/\W+/g, '-'), coverImageId: cover, releaseYear: 2020 });

function memoryStore() {
  const rows = new Map<string, ActivityGameRow>();
  const store: ActivityGameStore = {
    async get(key) { return rows.get(key) ?? null; },
    async set(key, value, resolvedAt) { rows.set(key, { ...value, resolvedAt }); },
  };
  return { rows, store };
}

function setup(client: Partial<IgdbClient>, now = () => 1_000_000_000_000) {
  const calls: string[] = [];
  const mem = memoryStore();
  const full: IgdbClient = {
    configured: true,
    async searchGames(query) { calls.push(`search:${query}`); return client.searchGames ? client.searchGames(query) : []; },
    async findSteamGame(id) { calls.push(`steam:${id}`); return client.findSteamGame ? client.findSteamGame(id) : null; },
    ...(client.configured === false ? { configured: false } : {}),
  };
  const inner = createActivityGameLookup({ client: full, reserve: async () => {}, postpone: async () => {}, store: mem.store, now });
  const lookup = async (userId: string, query: { steamAppId?: unknown; name?: unknown }) => inner(userId, parseActivityGameQuery(query));
  return { lookup, calls, mem };
}

const user = () => `u-${Math.random()}`;

describe('activity game lookup', () => {
  test('finds a Steam game by its app id and remembers it for everyone', async () => {
    const { lookup, calls, mem } = setup({ findSteamGame: async () => game('Dota 2', 'co5') });
    assert.deepEqual(await lookup(user(), { steamAppId: '570', name: 'Dota 2' }), { name: 'Dota 2', image: 'co5' });
    assert.deepEqual(await lookup(user(), { steamAppId: '570' }), { name: 'Dota 2', image: 'co5' });
    assert.deepEqual(calls, ['steam:570']);
    assert.equal(mem.rows.get('steam:570')?.image, 'co5');
  });

  test('falls back to the name when IGDB has no Steam entry or refuses the query', async () => {
    const { lookup, calls } = setup({
      findSteamGame: async () => { throw new ConnectionFetchError('unavailable'); },
      searchGames: async () => [game('Hades II'), game('Hades')],
    });
    assert.deepEqual(await lookup(user(), { steamAppId: '1145350', name: 'Hades' }), { name: 'Hades', image: 'co1' });
    assert.deepEqual(calls, ['steam:1145350', 'search:hades']);
  });

  test('keeps the detected name, without a cover, for a game IGDB does not know', async () => {
    const { lookup } = setup({ searchGames: async () => [] });
    assert.deepEqual(await lookup(user(), { name: 'My Indie Thing' }), { name: 'My Indie Thing', image: null });
  });

  test('does not remember a rate-limited answer', async () => {
    const { lookup, mem } = setup({ searchGames: async () => { throw new ConnectionFetchError('rate_limited', 1000); } });
    assert.deepEqual(await lookup(user(), { name: 'Minecraft' }), { name: 'Minecraft', image: null });
    assert.equal(mem.rows.size, 0);
  });

  test('without IGDB credentials, answers with the name and asks nobody', async () => {
    const { lookup, calls } = setup({ configured: false });
    assert.deepEqual(await lookup(user(), { name: 'Minecraft' }), { name: 'Minecraft', image: null });
    assert.deepEqual(calls, []);
  });

  test('refuses a request with neither a Steam id nor a name', async () => {
    const { lookup } = setup({});
    await assert.rejects(lookup(user(), { steamAppId: 'abc', name: ' ' }), (error) => error instanceof ActivityGameError && error.status === 400);
  });

  test('limits how many games one person makes the server look up', async () => {
    const { lookup } = setup({ searchGames: async (q) => [game(q)] });
    const me = user();
    for (let i = 0; i < 20; i++) await lookup(me, { name: `game ${i}` });
    await assert.rejects(lookup(me, { name: 'one more' }), (error) => error instanceof ActivityGameError && error.status === 429);
  });
});

describe('pickByName', () => {
  test('prefers the exact name over the first result', () => {
    assert.equal(pickByName([game('Hades II'), game('Hades')], 'hades')?.name, 'Hades');
    assert.equal(pickByName([game('Hades II')], 'Hades')?.name, 'Hades II');
    assert.equal(pickByName([], 'Hades'), null);
  });
});

describe('parseActivityGameQuery', () => {
  test('keys a game by its Steam id or name, and an app by its name apart from games', () => {
    assert.equal(parseActivityGameQuery({ steamAppId: '570', name: 'Dota 2' }).key, 'steam:570');
    assert.equal(parseActivityGameQuery({ name: 'Unity' }).key, 'name:unity');
    const app = parseActivityGameQuery({ steamAppId: '570', name: ' OBS  Studio ', kind: 'using' });
    assert.deepEqual(app, { key: 'app:obs studio', kind: 'using', steamAppId: null, name: 'OBS Studio' });
    assert.throws(() => parseActivityGameQuery({ name: ' ', kind: 'using' }), ActivityGameError);
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionFetchError } from '../../../src/integrations/connectionHttp.js';
import type { GridIcon, SteamGridDbClient } from '../../../src/integrations/steamgriddb/steamgriddb.js';
import { createActivityGameIconLookup, rankIcons, type ActivityGameIconRow, type ActivityGameIconStore } from '../../../src/modules/activity/activityGameIcons.js';
import { parseActivityGameQuery } from '../../../src/modules/activity/activityGames.js';

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const gridIcon = (name: string, style = 'official'): GridIcon => ({ url: `https://cdn2.steamgriddb.com/icon/${name}.png`, thumb: `https://cdn2.steamgriddb.com/icon_thumb/${name}.png`, style });

function setup(client: Partial<SteamGridDbClient>, options: { download?: (url: string) => Promise<Buffer>; now?: () => number } = {}) {
  const calls: string[] = [];
  const rows = new Map<string, ActivityGameIconRow>();
  const store: ActivityGameIconStore = {
    async get(key) { return rows.get(key) ?? null; },
    async set(key, iconId, resolvedAt) { rows.set(key, { iconId, resolvedAt }); },
  };
  const full: SteamGridDbClient = {
    configured: client.configured ?? true,
    async steamIcons(id) { calls.push(`steam:${id}`); return client.steamIcons ? client.steamIcons(id) : []; },
    async searchGames(term) { calls.push(`search:${term}`); return client.searchGames ? client.searchGames(term) : []; },
    async gameIcons(id) { calls.push(`game:${id}`); return client.gameIcons ? client.gameIcons(id) : []; },
  };
  const downloaded: string[] = [];
  const inner = createActivityGameIconLookup({
    client: full,
    download: async (url) => { downloaded.push(url); return options.download ? options.download(url) : Buffer.from(url); },
    storeIcon: async (bytes) => ({ id: `id:${bytes.toString()}` }),
    store,
    now: options.now ?? (() => NOW),
  });
  const lookup = (query: { steamAppId?: string; name?: string }, userId = `u-${Math.random()}`) => inner(userId, parseActivityGameQuery(query));
  return { lookup, calls, rows, downloaded };
}

describe('activity game icon lookup', () => {
  test('stores the icon of a Steam game once and serves it to everyone after', async () => {
    const { lookup, calls, rows } = setup({ steamIcons: async () => [gridIcon('dota')] });
    assert.equal(await lookup({ steamAppId: '570', name: 'Dota 2' }), 'id:https://cdn2.steamgriddb.com/icon_thumb/dota.png');
    assert.equal(await lookup({ steamAppId: '570' }), 'id:https://cdn2.steamgriddb.com/icon_thumb/dota.png');
    assert.deepEqual(calls, ['steam:570']);
    assert.equal(rows.get('steam:570')?.resolvedAt, NOW);
  });

  test('finds a game outside Steam by its name, preferring the exact one', async () => {
    const { lookup, calls } = setup({
      searchGames: async () => [{ id: 1, name: 'Fortnite Festival' }, { id: 2, name: 'Fortnite' }],
      gameIcons: async (id) => [gridIcon(`game-${id}`)],
    });
    assert.equal(await lookup({ name: 'Fortnite' }), 'id:https://cdn2.steamgriddb.com/icon_thumb/game-2.png');
    assert.deepEqual(calls, ['search:Fortnite', 'game:2']);
  });

  test('falls back to the name when the Steam id has no icon', async () => {
    const { lookup, calls } = setup({ searchGames: async () => [{ id: 9, name: 'Hades' }], gameIcons: async () => [gridIcon('hades')] });
    assert.ok(await lookup({ steamAppId: '1145360', name: 'Hades' }));
    assert.deepEqual(calls, ['steam:1145360', 'search:Hades', 'game:9']);
  });

  test('prefers the official icon, its PNG thumb first, and moves on from one that cannot be read', async () => {
    assert.deepEqual(rankIcons([gridIcon('a', 'custom'), gridIcon('b')]).map((icon) => icon.url), [gridIcon('b').url, gridIcon('a').url]);
    const { lookup, downloaded } = setup(
      { steamIcons: async () => [gridIcon('broken'), { ...gridIcon('good'), thumb: null }] },
      { download: async (url) => { if (url.includes('broken')) throw new Error('404'); return Buffer.from(url); } },
    );
    assert.equal(await lookup({ steamAppId: '10' }), 'id:https://cdn2.steamgriddb.com/icon/good.png');
    assert.deepEqual(downloaded, [gridIcon('broken').thumb, gridIcon('broken').url, gridIcon('good').url]);
  });

  test('remembers a game without an icon for a day only', async () => {
    let now = NOW;
    const { lookup, calls } = setup({}, { now: () => now });
    assert.equal(await lookup({ name: 'My Indie Thing' }), null);
    now += DAY - 1;
    assert.equal(await lookup({ name: 'My Indie Thing' }), null);
    assert.equal(calls.length, 1);
    now += 2;
    await lookup({ name: 'My Indie Thing' });
    assert.equal(calls.length, 2);
  });

  test('does not remember a failure, and never throws', async () => {
    const { lookup, rows } = setup({ steamIcons: async () => { throw new ConnectionFetchError('rate_limited', 1000); } });
    assert.equal(await lookup({ steamAppId: '570' }), null);
    assert.equal(rows.size, 0);
  });

  test('without a key, asks nobody', async () => {
    const { lookup, calls } = setup({ configured: false });
    assert.equal(await lookup({ name: 'Minecraft' }), null);
    assert.deepEqual(calls, []);
  });

  test('stops asking for one person past the budget, without failing', async () => {
    const { lookup, calls } = setup({});
    for (let i = 0; i < 25; i++) assert.equal(await lookup({ name: `game ${i}` }, 'same-person'), null);
    assert.equal(calls.length, 20);
  });
});

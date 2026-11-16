import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { ConnectionFetchError } from '../../../src/integrations/connectionHttp.js';
import type { GridGame, GridIcon, SteamGridDbClient } from '../../../src/integrations/steamgriddb/steamgriddb.js';
import { comparableName, createActivityGameIconLookup, pickGame, rankIcons, type ActivityGameIconRow, type ActivityGameIconStore } from '../../../src/modules/activity/activityGameIcons.js';
import { parseActivityGameQuery } from '../../../src/modules/activity/activityGames.js';

const NOW = 1_000_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const CLIENT = 'c'.repeat(40);
const COMMUNITY = 'd'.repeat(40);
const gridIcon = (name: string, style = 'official'): GridIcon => ({ url: `https://cdn2.steamgriddb.com/icon/${name}.ico`, thumb: `https://cdn2.steamgriddb.com/icon_thumb/${name}.png`, style });
const game = (id: number, name: string, extra: Partial<GridGame> = {}): GridGame => ({ id, name, releaseDate: null, steam: null, ...extra });
const onSteam = (id: number, name: string, appId: number, clientIcon: string | null = CLIENT): GridGame => game(id, name, { steam: { appId, clientIcon, icon: COMMUNITY } });

/** A one-entry .ico holding a PNG of this side. */
async function icoOf(side: number): Promise<Buffer> {
  const png = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 1 } } }).png().toBuffer();
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head[6] = side >= 256 ? 0 : side; head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}

function setup(client: Partial<SteamGridDbClient>, options: {
  files?: Record<string, Buffer | Error>;
  distances?: Record<string, number>;
  now?: () => number;
} = {}) {
  const calls: string[] = [];
  const rows = new Map<string, ActivityGameIconRow>();
  const store: ActivityGameIconStore = {
    async get(key) { return rows.get(key) ?? null; },
    async set(key, iconId, resolvedAt) { rows.set(key, { iconId, resolvedAt }); },
  };
  const full: SteamGridDbClient = {
    configured: client.configured ?? true,
    async steamGame(id) { calls.push(`steam:${id}`); return client.steamGame ? client.steamGame(id) : null; },
    async gameById(id) { calls.push(`game:${id}`); return client.gameById ? client.gameById(id) : null; },
    async searchGames(term) { calls.push(`search:${term}`); return client.searchGames ? client.searchGames(term) : []; },
    async gameIcons(id) { calls.push(`icons:${id}`); return client.gameIcons ? client.gameIcons(id) : []; },
  };
  const downloaded: string[] = [];
  const named = new Map<Buffer, string>();
  const inner = createActivityGameIconLookup({
    client: full,
    async download(url) {
      downloaded.push(url);
      const file = options.files?.[url];
      if (file instanceof Error) throw file;
      const bytes = file ?? Buffer.from(url);
      named.set(bytes, url);
      return bytes;
    },
    // what is stored is named after where it came from
    storeIcon: async (bytes) => ({ id: `id:${named.get(bytes) ?? 'steam-ico'}` }),
    distance: async (_reference, bytes) => options.distances?.[named.get(bytes) ?? ''] ?? 0.5,
    store,
    now: options.now ?? (() => NOW),
  });
  const lookup = (query: { steamAppId?: string; name?: string }, userId = `u-${Math.random()}`) => inner(userId, parseActivityGameQuery(query));
  return { lookup, calls, rows, downloaded };
}

const steamIco = (appId: number) => `https://shared.fastly.steamstatic.com/community_assets/images/apps/${appId}/${CLIENT}.ico`;
const steamJpg = (appId: number) => `https://shared.fastly.steamstatic.com/community_assets/images/apps/${appId}/${COMMUNITY}.jpg`;

describe('activity game icon lookup', () => {
  test('uses Steam\'s own icon when it is large enough, once for everyone', async () => {
    const { lookup, calls, rows, downloaded } = setup(
      { steamGame: async () => onSteam(5277816, 'Elden Ring', 1245620) },
      { files: { [steamIco(1245620)]: await icoOf(256) } },
    );
    assert.equal(await lookup({ steamAppId: '1245620', name: 'ELDEN RING' }), 'id:steam-ico');
    assert.equal(await lookup({ steamAppId: '1245620' }), 'id:steam-ico');
    assert.deepEqual(calls, ['steam:1245620']);
    assert.deepEqual(downloaded, [steamIco(1245620)]);
    assert.equal(rows.get('steam:1245620')?.resolvedAt, NOW);
  });

  test('with a small Steam icon, takes the community icon that looks most like it', async () => {
    const icons = [gridIcon('fan-art'), gridIcon('real', 'custom'), gridIcon('closer-fan-art')];
    const { lookup } = setup(
      { steamGame: async () => onSteam(9569, 'Stardew Valley', 413150), gameIcons: async () => icons },
      {
        files: { [steamIco(413150)]: await icoOf(32) },
        distances: { [icons[0]!.thumb!]: 0.4, [icons[1]!.thumb!]: 0.02, [icons[2]!.thumb!]: 0.19 },
      },
    );
    assert.equal(await lookup({ steamAppId: '413150' }), `id:${icons[1]!.thumb}`);
  });

  test('keeps Steam\'s small icon when no community icon looks like it', async () => {
    const { lookup } = setup(
      { steamGame: async () => onSteam(31588, 'Among Us', 945360, null), gameIcons: async () => [gridIcon('fan-art')] },
      { distances: { [gridIcon('fan-art').thumb!]: 0.3 } },
    );
    assert.equal(await lookup({ steamAppId: '945360' }), `id:${steamJpg(945360)}`);
  });

  test('outside Steam, takes the first official icon, its PNG thumb first', async () => {
    const { lookup, calls } = setup({
      searchGames: async () => [game(1, 'Fortnite Festival'), game(36136, 'Fortnite')],
      gameById: async (id) => game(id, 'Fortnite'),
      gameIcons: async () => [gridIcon('custom', 'custom'), gridIcon('official')],
    });
    assert.equal(await lookup({ name: 'Fortnite' }), `id:${gridIcon('official').thumb}`);
    assert.deepEqual(calls, ['search:Fortnite', 'game:36136', 'icons:36136']);
  });

  test('moves on from a community icon that cannot be read', async () => {
    const broken = gridIcon('broken');
    const { lookup, downloaded } = setup(
      { searchGames: async () => [game(7, 'Hades')], gameIcons: async () => [broken, { ...gridIcon('good'), thumb: null }] },
      { files: { [broken.thumb!]: new Error('404'), [broken.url]: new Error('404') } },
    );
    assert.equal(await lookup({ name: 'Hades' }), `id:${gridIcon('good').url}`);
    assert.deepEqual(downloaded, [broken.thumb, broken.url, gridIcon('good').url]);
  });

  test('falls back to the name when SteamGridDB does not know the Steam id', async () => {
    const { lookup, calls } = setup({ searchGames: async () => [game(9, 'Hades')], gameIcons: async () => [gridIcon('hades')] });
    assert.ok(await lookup({ steamAppId: '1145360', name: 'Hades' }));
    assert.deepEqual(calls, ['steam:1145360', 'search:Hades', 'game:9', 'icons:9']);
  });

  test('takes no game whose name is only close, rather than another game\'s icon', async () => {
    const { lookup, calls } = setup({ searchGames: async () => [game(1, 'Baldur\'s Gate 3 Toolkit'), game(2, 'Baldur\'s Gate III Mod Manager')] });
    assert.equal(await lookup({ name: 'Baldur\'s Gate 3' }), null);
    assert.deepEqual(calls, ['search:Baldur\'s Gate 3']);
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
    const { lookup, rows } = setup({ steamGame: async () => { throw new ConnectionFetchError('rate_limited', 1000); } });
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

describe('picking the game by name', () => {
  test('compares names without marks, punctuation or case, reading roman numerals', () => {
    assert.equal(comparableName('NieR:Automata™'), comparableName('NieR: Automata'));
    assert.equal(comparableName('DARK SOULS™ III'), comparableName('Dark Souls 3'));
    assert.equal(comparableName('osu!'), comparableName('Osu!'));
    assert.equal(comparableName('Tom Clancy’s Rainbow Six® Siege'), comparableName('Tom Clancy\'s Rainbow Six Siege'));
    assert.notEqual(comparableName('Hades II'), comparableName('Hades'));
  });

  test('takes the latest released of games sharing the name', () => {
    const picked = pickGame([game(1, 'Call of Duty', { releaseDate: 1067212800 }), game(2, 'Call of Duty', { releaseDate: 1666224000 }), game(3, 'Call of Duty: World at War')], 'Call of Duty');
    assert.equal(picked?.id, 2);
    assert.equal(pickGame([game(4, 'Baldur\'s Gate III')], 'Baldur\'s Gate 3')?.id, 4);
  });

  test('ranks official icons first, keeping SteamGridDB\'s order', () => {
    assert.deepEqual(rankIcons([gridIcon('a', 'custom'), gridIcon('b'), gridIcon('c')]).map((icon) => icon.url), [gridIcon('b').url, gridIcon('c').url, gridIcon('a').url]);
  });
});

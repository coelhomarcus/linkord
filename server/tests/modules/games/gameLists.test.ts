import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseGameLists, toGameItem } from '../../../src/modules/games/gameLists.js';
import { GAME_LIST_LIMITS, GAME_LISTS, GAME_WIDGET_TYPES, gameListOf } from '../../../src/modules/games/types.js';

const game = (igdbId: number, extra: Record<string, unknown> = {}) => ({ igdbId, name: `Game ${igdbId}`, slug: `game-${igdbId}`, coverImageId: 'co1abc', releaseYear: 1999, ...extra });
const many = (count: number) => Array.from({ length: count }, (_, i) => game(i + 1));

describe('game lists input', () => {
  it('accepts no lists, some lists, and empty lists', () => {
    assert.deepEqual(parseGameLists(undefined), {});
    assert.deepEqual(parseGameLists({}), {});
    assert.deepEqual(parseGameLists({ liked: [], wishlist: [game(2)] }), { liked: [], wishlist: [game(2)] });
  });
  it('keeps only the snapshot fields, in the shape the client gets back', () => {
    const parsed = parseGameLists({ favorite: [{ ...game(1), url: 'https://evil.example', imageUrl: 'https://evil.example/x.jpg' }] });
    assert.deepEqual(parsed, { favorite: [game(1)] });
  });
  it('enforces the size of each list: one favorite, eight of the others', () => {
    assert.deepEqual(GAME_LIST_LIMITS, { favorite: 1, liked: 8, playing: 8, wishlist: 8 });
    assert.ok(parseGameLists({ favorite: many(1), liked: many(8), playing: many(8), wishlist: many(8) }));
    assert.equal(parseGameLists({ favorite: many(2) }), null);
    for (const list of ['liked', 'playing', 'wishlist']) assert.equal(parseGameLists({ [list]: many(9) }), null);
  });
  it('rejects repeated games within a list but lets a game be in several lists', () => {
    assert.equal(parseGameLists({ liked: [game(1), game(1, { name: 'Again' })] }), null);
    assert.ok(parseGameLists({ favorite: [game(1)], liked: [game(1)], wishlist: [game(1)] }));
  });
  it('rejects unknown lists and anything that is not a list of games', () => {
    for (const input of [[], null, 'liked', 3, { loved: [] }, { liked: 'x' }, { liked: {} }, { liked: [null] }, { liked: ['x'] }, { liked: [[]] }]) assert.equal(parseGameLists(input), null);
  });
  it('rejects a game with a field that is wrong or could be used to build a bad link', () => {
    const bad: Record<string, unknown>[] = [
      { igdbId: 0 }, { igdbId: -1 }, { igdbId: 1.5 }, { igdbId: '1' }, { igdbId: 2 ** 31 }, { igdbId: undefined },
      { name: '' }, { name: ' padded ' }, { name: 'x'.repeat(201) }, { name: 5 },
      { slug: '' }, { slug: '../admin' }, { slug: 'a/b' }, { slug: 'Upper' }, { slug: 'a b' }, { slug: 'x'.repeat(201) },
      { coverImageId: 'https://evil.example/a.jpg' }, { coverImageId: '../x' }, { coverImageId: '' }, { coverImageId: undefined },
      { releaseYear: 1800 }, { releaseYear: 2300 }, { releaseYear: 1999.5 }, { releaseYear: '1999' }, { releaseYear: undefined },
    ];
    for (const extra of bad) assert.equal(parseGameLists({ liked: [game(1, extra)] }), null, JSON.stringify(extra));
  });
  it('accepts a game without a cover or a release year', () => {
    assert.ok(parseGameLists({ liked: [game(1, { coverImageId: null, releaseYear: null })] }));
  });
});

describe('game items', () => {
  it('builds the link on the IGDB host and the cover through our proxy', () => {
    assert.deepEqual(toGameItem(game(5)), { ...game(5), url: 'https://www.igdb.com/games/game-5', imageUrl: '/api/media-proxy/igdb/cover_big/co1abc' });
    assert.equal(toGameItem(game(5), 'cover_small').imageUrl, '/api/media-proxy/igdb/cover_small/co1abc');
    assert.equal(toGameItem(game(5, { coverImageId: null })).imageUrl, null);
  });
  it('maps every list to its own widget type and back', () => {
    assert.equal(new Set(Object.values(GAME_WIDGET_TYPES)).size, GAME_LISTS.length);
    for (const list of GAME_LISTS) assert.equal(gameListOf(GAME_WIDGET_TYPES[list]), list);
    for (const type of ['mal-recent-anime', 'github-profile', '', 'igdb-other']) assert.equal(gameListOf(type), null);
  });
});

describe('web mirror', () => {
  const web = fs.readFileSync(path.resolve(import.meta.dirname, '../../../../web/src/features/games/types.ts'), 'utf8');
  it('names the same lists, widget types and limits as the client', () => {
    for (const list of GAME_LISTS) assert.ok(web.includes(`${list}: '${GAME_WIDGET_TYPES[list]}'`), `widget type of ${list}`);
    assert.ok(web.includes(`GAME_LISTS = [${GAME_LISTS.map((list) => `'${list}'`).join(', ')}]`));
    const limits = Object.entries(GAME_LIST_LIMITS).map(([list, max]) => `${list}: ${max}`).join(', ');
    assert.ok(web.includes(`GAME_LIST_LIMITS: Record<GameList, number> = { ${limits} }`));
  });
  it('builds the big cover the way the server does', () => {
    assert.ok(web.includes("igdbCoverProxyUrl(game.coverImageId, 'cover_big')"));
  });
});

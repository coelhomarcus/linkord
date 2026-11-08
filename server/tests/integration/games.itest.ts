import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { connectionSyncLimits, profileConnections, profileGames, profileWallWidgets, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { ConnectionFetchError } from '../../src/integrations/connectionHttp.js';
import { createSession } from '../../src/modules/auth/session.js';
import { ConnectionMutationError, listConnections, mutateConnection, readWall, saveWall } from '../../src/modules/connections/connections.js';
import { IGDB_REQUEST_INTERVAL_MS, postponeIgdb, reserveIgdbSlot } from '../../src/modules/games/igdbLimiter.js';
import { createIsolatedDatabase } from '../../src/scripts/rehearsal/isolatedDb.js';
import { makeMigrationsFolder } from '../../src/scripts/rehearsal/migrationFolders.js';
import { migrateOn } from '../../src/scripts/rehearsal/migrateOn.js';
import { befriend, db, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });
afterEach(async () => { await db.delete(connectionSyncLimits); });
async function headers(userId: string) { return { cookie: `${config.SESSION_COOKIE}=${(await createSession(userId)).rawToken}` }; }
const game = (igdbId: number, extra: Record<string, unknown> = {}) => ({ igdbId, name: `Game ${igdbId}`, slug: `game-${igdbId}`, coverImageId: 'co1abc', releaseYear: 2001, ...extra });
type Shown = { data: { kind: string } | null };
const gamesOf = (widget: Shown | undefined) => widget?.data?.kind === 'games' ? (widget.data as unknown as { items: { name: string }[] }).items : [];
const names = (items: { name: string }[]) => items.map((item) => item.name);
const invalidWall = (error: unknown) => error instanceof ConnectionMutationError && error.code === 'invalid_wall';

describe('games widgets (real Postgres)', () => {
  it('migrates existing widgets to carry their owner, and lets a games widget have no connection', async () => {
    const isolated = await createIsolatedDatabase(process.env.TEST_DATABASE_BASE_URL ?? process.env.DATABASE_URL!, 'test', `games_${Date.now().toString(36)}`);
    const old = makeMigrationsFolder({ toIdx: 49 }); const latest = makeMigrationsFolder();
    try {
      await migrateOn(isolated.pool, old.folder);
      const userId = crypto.randomUUID(); const connectionId = crypto.randomUUID();
      await isolated.pool.query('INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3)', [userId, 'legacy', 'unused']);
      await isolated.pool.query("INSERT INTO profile_connections (id, user_id, provider, value, url, position) VALUES ($1, $2, 'github', 'octocat', 'https://github.com/octocat', 0)", [connectionId, userId]);
      await isolated.pool.query("INSERT INTO profile_wall_widgets (id, connection_id, type, position) VALUES ('w1', $1, 'github-profile', 0), ('w2', $1, 'github-calendar', 1)", [connectionId]);
      await migrateOn(isolated.pool, latest.folder);
      const rows = (await isolated.pool.query('SELECT id, user_id, connection_id, type FROM profile_wall_widgets ORDER BY position')).rows;
      assert.deepEqual(rows.map((row) => [row.id, row.user_id, row.connection_id, row.type]), [['w1', userId, connectionId, 'github-profile'], ['w2', userId, connectionId, 'github-calendar']]);
      await isolated.pool.query("INSERT INTO profile_wall_widgets (id, user_id, connection_id, type, position) VALUES ('g1', $1, NULL, 'igdb-favorite-game', 2)", [userId]);
      // a games widget cannot hide behind a connection, nor an account widget lose its own
      await assert.rejects(isolated.pool.query("INSERT INTO profile_wall_widgets (id, user_id, connection_id, type, position) VALUES ('g2', $1, $2, 'igdb-liked-games', 3)", [userId, connectionId]));
      await assert.rejects(isolated.pool.query("INSERT INTO profile_wall_widgets (id, user_id, connection_id, type, position) VALUES ('g3', $1, NULL, 'github-profile', 3)", [userId]));
      await assert.rejects(isolated.pool.query("INSERT INTO profile_wall_widgets (id, user_id, connection_id, type, position) VALUES ('g4', $1, NULL, 'igdb-favorite-game', 3)", [userId]));
      await assert.rejects(isolated.pool.query("INSERT INTO profile_games (id, user_id, list, igdb_id, name, slug, position) VALUES ('x', $1, 'loved', 1, 'n', 's', 0)", [userId]));
    } finally { old.cleanup(); latest.cleanup(); await isolated.drop(); }
  });

  it('offers the four games widgets to the owner with no connection at all, and nobody else', async () => {
    const owner = await makeUser('gamesoffer'); const friend = await makeUser('gamesfriend');
    await befriend(owner.id, friend.id);
    const mine = await readWall(owner.id, true);
    assert.deepEqual(mine.available?.map((widget) => [widget.connection, widget.type, widget.data]), [
      [null, 'igdb-favorite-game', { kind: 'games', items: [] }], [null, 'igdb-liked-games', { kind: 'games', items: [] }],
      [null, 'igdb-playing-games', { kind: 'games', items: [] }], [null, 'igdb-wishlist-games', { kind: 'games', items: [] }],
    ]);
    const viewed = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/wall`, headers: await headers(friend.id) });
    assert.deepEqual(viewed.json(), { widgets: [] });
  });

  it('saves the widgets and the games in one request, in order, and shows them to a friend', async () => {
    const owner = await makeUser('gamesave'); const friend = await makeUser('gamesviewer'); const stranger = await makeUser('gstranger');
    await befriend(owner.id, friend.id);
    await mutateConnection(owner.id, 'create', { provider: 'github', value: 'octocat' });
    const github = (await listConnections(owner.id))[0]!;
    const auth = await headers(owner.id);
    const saved = await app.inject({ method: 'PUT', url: '/api/me/wall', headers: auth, payload: {
      widgets: [{ connectionId: null, type: 'igdb-liked-games' }, { connectionId: github.id, type: 'github-profile' }, { type: 'igdb-favorite-game' }],
      games: { favorite: [game(10)], liked: [game(3), game(1), game(2)] },
    } });
    assert.equal(saved.statusCode, 200);
    const body = saved.json();
    assert.deepEqual(body.widgets.map((widget: { type: string }) => widget.type), ['igdb-liked-games', 'github-profile', 'igdb-favorite-game']);
    assert.deepEqual(names(body.widgets[0].data.items), ['Game 3', 'Game 1', 'Game 2']);
    assert.equal(body.widgets[0].connection, null);
    assert.deepEqual(body.widgets[0].data.items[0], { ...game(3), url: 'https://www.igdb.com/games/game-3', imageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg' });
    assert.equal(body.available.length, 6);
    const viewed = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/wall`, headers: await headers(friend.id) });
    assert.deepEqual(viewed.json().widgets.map((widget: { type: string }) => widget.type), ['igdb-liked-games', 'github-profile', 'igdb-favorite-game']);
    assert.equal(viewed.body.includes('available'), false);
    // a person who cannot see the profile gets the same answer as for a missing one
    const denied = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/wall`, headers: await headers(stranger.id) });
    assert.equal(denied.statusCode, 404); assert.equal(denied.body.includes('Game'), false);
  });

  it('leaves lists alone when the request does not mention them, and replaces the ones it does', async () => {
    const owner = await makeUser('gamekeep');
    const wall = [{ connectionId: null, type: 'igdb-liked-games' }, { connectionId: null, type: 'igdb-wishlist-games' }];
    await saveWall(owner.id, wall, { liked: [game(1), game(2)], wishlist: [game(9)] });
    await saveWall(owner.id, wall, { liked: [game(2), game(5)] });
    const after = (await readWall(owner.id)).widgets;
    assert.deepEqual(after.map((widget) => names(gamesOf(widget))), [['Game 2', 'Game 5'], ['Game 9']]);
    await saveWall(owner.id, wall);
    assert.equal((await readWall(owner.id)).widgets.length, 2);
    await saveWall(owner.id, wall, { liked: [], wishlist: [] });
    assert.deepEqual((await readWall(owner.id)).widgets.map((widget) => gamesOf(widget).length), [0, 0]);
  });

  it('keeps the picks of a widget taken off the Wall, so adding it back restores them', async () => {
    const owner = await makeUser('gameback');
    await saveWall(owner.id, [{ connectionId: null, type: 'igdb-playing-games' }], { playing: [game(4)] });
    await saveWall(owner.id, []);
    assert.deepEqual((await readWall(owner.id)).widgets, []);
    assert.equal((await db.select().from(profileGames).where(eq(profileGames.userId, owner.id))).length, 1);
    await saveWall(owner.id, [{ connectionId: null, type: 'igdb-playing-games' }]);
    assert.deepEqual(names(gamesOf((await readWall(owner.id)).widgets[0])), ['Game 4']);
  });

  it('lets the same game sit in several lists, and keeps one list from touching another person', async () => {
    const owner = await makeUser('gamemulti'); const other = await makeUser('gameother');
    await saveWall(owner.id, [], { favorite: [game(1)], liked: [game(1)], wishlist: [game(1)] });
    await saveWall(other.id, [], { liked: [game(1)] });
    await saveWall(owner.id, [], { liked: [] });
    assert.equal((await db.select().from(profileGames).where(eq(profileGames.userId, owner.id))).length, 2);
    assert.equal((await db.select().from(profileGames).where(eq(profileGames.userId, other.id))).length, 1);
  });

  it('rejects over-limit, repeated, malformed and misplaced input without changing anything', async () => {
    const owner = await makeUser('gamebad');
    await saveWall(owner.id, [{ connectionId: null, type: 'igdb-liked-games' }], { liked: [game(1)] });
    const many = (n: number) => Array.from({ length: n }, (_, i) => game(i + 1));
    const bad: [unknown, unknown][] = [
      [[{ connectionId: null, type: 'igdb-favorite-game' }], { favorite: many(2) }],
      [[{ connectionId: null, type: 'igdb-liked-games' }], { liked: many(9) }],
      [[{ connectionId: null, type: 'igdb-liked-games' }], { liked: [game(1), game(1)] }],
      [[{ connectionId: null, type: 'igdb-liked-games' }], { liked: [game(2, { slug: '../x' })] }],
      [[{ connectionId: null, type: 'igdb-liked-games' }], { loved: [game(2)] }],
      [[{ connectionId: null, type: 'igdb-liked-games' }], [game(2)]],
      [[{ connectionId: null, type: 'igdb-liked-games' }, { connectionId: null, type: 'igdb-liked-games' }], undefined],
      [[{ connectionId: 'someone-elses', type: 'igdb-liked-games' }], undefined],
      [[{ connectionId: null, type: 'igdb-nope' }], undefined],
      [[{ connectionId: null, type: 'github-profile' }], undefined],
    ];
    for (const [widgets, games] of bad) await assert.rejects(saveWall(owner.id, widgets, games), invalidWall);
    const wall = (await readWall(owner.id)).widgets;
    assert.equal(wall.length, 1); assert.deepEqual(names(gamesOf(wall[0])), ['Game 1']);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/me/wall', headers: await headers(owner.id), payload: { widgets: [], games: 'x' } })).statusCode, 400);
  });

  it('removes a connection widget without touching the games widgets, and the reverse', async () => {
    const owner = await makeUser('gamemix');
    await mutateConnection(owner.id, 'create', { provider: 'github', value: 'octocat' });
    const github = (await listConnections(owner.id))[0]!;
    const wall = [{ connectionId: null, type: 'igdb-favorite-game' }, { connectionId: github.id, type: 'github-profile' }];
    await saveWall(owner.id, wall, { favorite: [game(1)] });
    await mutateConnection(owner.id, 'delete', {}, github.id);
    assert.deepEqual((await readWall(owner.id)).widgets.map((widget) => widget.type), ['igdb-favorite-game']);
    await mutateConnection(owner.id, 'create', { provider: 'github', value: 'octocat' });
    const again = (await listConnections(owner.id))[0]!;
    await db.update(profileConnections).set({ showOnProfile: false }).where(eq(profileConnections.id, again.id));
    // a hidden connection does not stop the games widgets from being saved or shown
    await saveWall(owner.id, [{ connectionId: null, type: 'igdb-favorite-game' }, { connectionId: null, type: 'igdb-wishlist-games' }]);
    assert.deepEqual((await readWall(owner.id)).widgets.map((widget) => widget.type), ['igdb-favorite-game', 'igdb-wishlist-games']);
  });

  it('deletes the widgets and picks with the account', async () => {
    const owner = await makeUser('gamegone');
    await saveWall(owner.id, [{ connectionId: null, type: 'igdb-favorite-game' }], { favorite: [game(1)] });
    await db.delete(users).where(eq(users.id, owner.id));
    assert.equal((await db.select().from(profileGames).where(eq(profileGames.userId, owner.id))).length, 0);
    assert.equal((await db.select().from(profileWallWidgets).where(eq(profileWallWidgets.userId, owner.id))).length, 0);
  });
});

describe('game search route (real Postgres)', () => {
  it('needs a session, a long enough query, and credentials; without them the server stays up', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/games/search?q=zelda' })).statusCode, 401);
    const auth = await headers((await makeUser('gamesearch')).id);
    for (const url of ['/api/games/search', '/api/games/search?q=', '/api/games/search?q=a', `/api/games/search?q=${'x'.repeat(65)}`]) {
      const response = await app.inject({ method: 'GET', url, headers: auth });
      assert.equal(response.statusCode, 400, url); assert.equal(response.json().error.code, 'invalid_request');
    }
    // the test environment has no IGDB credentials
    assert.equal(config.IGDB_CLIENT_ID, '');
    const unavailable = await app.inject({ method: 'GET', url: '/api/games/search?q=zelda', headers: auth });
    assert.equal(unavailable.statusCode, 503); assert.equal(unavailable.json().error.code, 'games_unavailable');
  });
});

describe('IGDB request slots (real Postgres)', () => {
  it('hands out one slot per interval across callers', async () => {
    const started = Date.now();
    const times = await Promise.all(Array.from({ length: 4 }, async () => { await reserveIgdbSlot(5000); return Date.now() - started; }));
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert.ok(times[i]! - times[i - 1]! >= IGDB_REQUEST_INTERVAL_MS - 40, `slots too close: ${times.join(', ')}`);
  });
  it('gives up with the wait when the next slot is further than the patience allows', async () => {
    await reserveIgdbSlot();
    await assert.rejects(reserveIgdbSlot(10), (error: ConnectionFetchError) => error.code === 'rate_limited' && error.retryAfterMs > 0 && error.retryAfterMs <= IGDB_REQUEST_INTERVAL_MS);
  });
  it('holds everyone back after IGDB itself said to wait, and never shortens a longer wait', async () => {
    await postponeIgdb(30_000);
    await assert.rejects(reserveIgdbSlot(100), (error: ConnectionFetchError) => error.code === 'rate_limited' && error.retryAfterMs > 25_000);
    await postponeIgdb(1);
    await assert.rejects(reserveIgdbSlot(100), (error: ConnectionFetchError) => error.retryAfterMs > 25_000);
  });
  it('does not touch the connection sync budget of the other providers', async () => {
    await reserveIgdbSlot();
    assert.deepEqual((await db.select().from(connectionSyncLimits)).map((row) => row.provider), ['igdb']);
  });
});

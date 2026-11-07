import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, describe, it, mock } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { connectionSyncLimits, profileConnections, profileWallWidgets, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { ConnectionMutationError, listConnections, mutateConnection, readWall, saveWall } from '../../src/modules/connections/connections.js';
import { syncConnections } from '../../src/modules/connections/syncWorker.js';
import { GITHUB_SYNC_INTERVAL_MS, SYNC_INTERVAL_MS } from '../../src/modules/connections/policy.js';
import { updateProfile } from '../../src/modules/profile/profileRepository.js';
import { ConnectionFetchError } from '../../src/integrations/connectionHttp.js';
import type { RequestJson } from '../../src/integrations/connectionHttp.js';
import type { ConnectionSnapshot } from '../../src/modules/connections/types.js';
import { createIsolatedDatabase } from '../../src/scripts/rehearsal/isolatedDb.js';
import { makeMigrationsFolder } from '../../src/scripts/rehearsal/migrationFolders.js';
import { migrateOn } from '../../src/scripts/rehearsal/migrateOn.js';
import { befriend, db, makeServerWithMembers, makeUser, pool } from './helpers.js';
import { githubCalendarFixture, githubUserFixture } from '../fixtures/githubFixture.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });
afterEach(async () => { await db.delete(connectionSyncLimits); await db.update(profileConnections).set({ nextSyncAt: new Date('2100-01-01'), leaseToken: null, leaseUntil: null }); });
async function headers(userId: string) { return { cookie: `${config.SESSION_COOKIE}=${(await createSession(userId)).rawToken}` }; }
const snapshot: ConnectionSnapshot = { widgets: {
  'mal-recent-anime': { kind: 'list', items: [{ id: '1', title: 'Published activity', url: 'https://myanimelist.net/anime/1', imageUrl: null }] },
} };
const githubSnapshot: ConnectionSnapshot = { widgets: {
  'github-profile': { kind: 'github-profile', login: 'unpublishedlogin', name: null, avatarUrl: null, repositories: 1, followers: 2, following: 3 },
} };
const request: RequestJson = async () => ({ data: [{ node: { id: 1, title: 'Recent' } }] });
// the worker reads the client ID from the environment, which these tests leave unset
const sync = (options: Parameters<typeof syncConnections>[0] = {}) => syncConnections({ malClientId: 'test-client', ...options });
async function mal(userId: string) {
  await mutateConnection(userId, 'create', { provider: 'myanimelist', value: 'syncuser' });
  return (await listConnections(userId))[0]!;
}

describe('profile connections (real Postgres)', () => {
  it('migrates existing URLs in order without upgrading service links or changing profileLinks', async () => {
    const isolated = await createIsolatedDatabase(process.env.TEST_DATABASE_BASE_URL ?? process.env.DATABASE_URL!, 'test', `connections_${Date.now().toString(36)}`);
    const old = makeMigrationsFolder({ toIdx: 44 }); const latest = makeMigrationsFolder();
    try {
      await migrateOn(isolated.pool, old.folder);
      const id = crypto.randomUUID(); const links = ['https://github.com/octocat', 'https://myanimelist.net/profile/Xinil', 'https://example.com'];
      await isolated.pool.query('INSERT INTO users (id, username, password_hash, profile_links) VALUES ($1, $2, $3, $4::jsonb)', [id, 'legacy', 'unused', JSON.stringify(links)]);
      await migrateOn(isolated.pool, latest.folder);
      const result = await isolated.pool.query('SELECT provider, url, position FROM profile_connections WHERE user_id=$1 ORDER BY position', [id]);
      assert.deepEqual(result.rows.map((row) => row.url), links);
      assert.deepEqual(result.rows.map((row) => row.position), [0, 1, 2]);
      assert.ok(result.rows.every((row) => row.provider === 'url'));
      assert.deepEqual((await isolated.pool.query('SELECT profile_links FROM users WHERE id=$1', [id])).rows[0].profile_links, links);
    } finally { old.cleanup(); latest.cleanup(); await isolated.drop(); }
  });
  it('supports URL CRUD, preserves the projection during profile saves, and hides foreign connections', async () => {
    const owner = await makeUser('conn'); const stranger = await makeUser('other');
    const auth = await headers(owner.id);
    const created = await app.inject({ method: 'POST', url: '/api/me/connections', headers: auth, payload: { provider: 'url', value: 'https://example.com' } });
    assert.equal(created.statusCode, 201);
    const id = created.json().connections[0].id;
    const denied = await app.inject({ method: 'PATCH', url: `/api/me/connections/${id}`, headers: await headers(stranger.id), payload: { value: 'https://evil.example' } });
    assert.equal(denied.statusCode, 404);
    const edited = await app.inject({ method: 'PATCH', url: `/api/me/connections/${id}`, headers: auth, payload: { value: 'https://example.com/new' } });
    assert.equal(edited.statusCode, 200);
    const saved = await updateProfile(owner.id, { avatar: '', avatarPoster: '', avatarColor: 'green', displayName: 'Owner', banner: '', bannerPoster: '', bio: 'bio', profileLinks: [] });
    assert.deepEqual(saved?.profileLinks, ['https://example.com/new']);
    const removed = await app.inject({ method: 'DELETE', url: `/api/me/connections/${id}`, headers: auth });
    assert.equal(removed.statusCode, 200);
    const [row] = await db.select().from(users).where(eq(users.id, owner.id));
    assert.deepEqual(row?.profileLinks, []);
    assert.equal((await app.inject({ method: 'GET', url: '/api/me/connections' })).statusCode, 401);
  });
  it('enforces count and service uniqueness under concurrent writes', async () => {
    const owner = await makeUser('limit');
    const results = await Promise.allSettled(Array.from({ length: 9 }, (_, i) => mutateConnection(owner.id, 'create', { provider: 'url', value: `https://example.com/${i}` })));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 8);
    assert.equal((await listConnections(owner.id)).length, 8);
    const another = await makeUser('unique');
    await mal(another.id);
    await assert.rejects(mutateConnection(another.id, 'create', { provider: 'myanimelist', value: 'otheruser' }), (error: ConnectionMutationError) => error.code === 'connection_exists');
    await assert.rejects(mutateConnection(another.id, 'create', { provider: 'url', value: 'https://myanimelist.net/profile/syncuser' }), (error: ConnectionMutationError) => error.code === 'connection_exists');
  });
  it('connects and syncs GitHub without credentials and validates provider input', async () => {
    const calendar = githubCalendarFixture();
    const network = mock.method(globalThis, 'fetch', async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(new Headers(init?.headers).has('authorization'), false);
      return new Response(String(url).startsWith('https://api.github.com/') ? JSON.stringify(githubUserFixture) : calendar);
    });
    try {
      const owner = await makeUser('github'); const auth = await headers(owner.id);
      const result = await app.inject({ method: 'POST', url: '/api/me/connections', headers: auth, payload: { provider: 'github', value: 'octocat' } });
      assert.equal(result.statusCode, 201);
      for (let attempt = 0; attempt < 100 && !(await listConnections(owner.id))[0]?.syncedAt; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const row = (await listConnections(owner.id))[0]!;
      assert.ok(row.syncedAt); assert.equal(row.snapshot?.widgets['github-calendar']?.kind, 'github-calendar');
      assert.equal((await app.inject({ method: 'GET', url: '/api/me/connections', headers: auth })).json().connections[0].provider, 'github');
      assert.equal((await app.inject({ method: 'POST', url: '/api/me/connections', headers: auth, payload: { provider: 'myanimelist', value: '../bad' } })).statusCode, 400);
    } finally { network.mock.restore(); }
  });
});

describe('profile Wall publication (real Postgres)', () => {
  it('requires explicit publication and returns only selected widget data to allowed viewers', async () => {
    const owner = await makeUser('wall'); const friend = await makeUser('friend'); const stranger = await makeUser('stranger'); const admin = await makeUser('admin', 'admin');
    const connection = await mal(owner.id);
    await db.update(profileConnections).set({ snapshot, syncedAt: new Date() }).where(eq(profileConnections.id, connection.id));
    await mutateConnection(owner.id, 'create', { provider: 'github', value: 'octocat' });
    const github = (await listConnections(owner.id)).find((row) => row.provider === 'github')!;
    await db.update(profileConnections).set({ snapshot: githubSnapshot, syncedAt: new Date() }).where(eq(profileConnections.id, github.id));
    await befriend(owner.id, friend.id);
    assert.deepEqual(await readWall(owner.id), { widgets: [] });
    const auth = await headers(owner.id);
    const saved = await app.inject({ method: 'PUT', url: '/api/me/wall', headers: auth, payload: { widgets: [{ connectionId: connection.id, type: 'mal-recent-anime' }] } });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().available.length, 3);
    const viewed = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/wall`, headers: await headers(friend.id) });
    assert.equal(viewed.statusCode, 200);
    assert.equal(viewed.json().widgets.length, 1);
    assert.equal(viewed.body.includes('Published activity'), true);
    assert.equal(viewed.body.includes('unpublishedlogin'), false);
    assert.equal(viewed.body.includes('available'), false);
    assert.equal(viewed.body.includes('snapshot'), false);
    const denied = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/wall`, headers: await headers(stranger.id) });
    const missing = await app.inject({ method: 'GET', url: '/api/users/missing/wall', headers: await headers(stranger.id) });
    assert.equal(denied.statusCode, 404); assert.deepEqual(denied.json(), missing.json());
    assert.equal((await app.inject({ method: 'GET', url: `/api/users/${owner.id}/wall`, headers: await headers(admin.id) })).statusCode, 200);
    await makeServerWithMembers(owner.id, [stranger.id]);
    assert.equal((await app.inject({ method: 'GET', url: `/api/users/${owner.id}/wall`, headers: await headers(stranger.id) })).statusCode, 200);
  });
  it('hides a connection from the public links and the Wall without losing its widgets', async () => {
    const owner = await makeUser('hide'); const friend = await makeUser('hidefriend');
    await befriend(owner.id, friend.id);
    const connection = await mal(owner.id);
    await db.update(profileConnections).set({ snapshot, syncedAt: new Date() }).where(eq(profileConnections.id, connection.id));
    await mutateConnection(owner.id, 'create', { provider: 'url', value: 'https://example.com/kept' });
    await saveWall(owner.id, [{ connectionId: connection.id, type: 'mal-recent-anime' }]);
    const auth = await headers(owner.id);

    const hidden = await app.inject({ method: 'PATCH', url: `/api/me/connections/${connection.id}`, headers: auth, payload: { showOnProfile: false } });
    assert.equal(hidden.statusCode, 200);
    assert.equal(hidden.json().connections.find((row: { id: string }) => row.id === connection.id).showOnProfile, false);
    const [row] = await db.select().from(users).where(eq(users.id, owner.id));
    assert.deepEqual(row?.profileLinks, ['https://example.com/kept']);
    assert.equal((await listConnections(owner.id)).find((item) => item.id === connection.id)?.value, 'syncuser');

    const viewed = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/wall`, headers: await headers(friend.id) });
    assert.deepEqual(viewed.json().widgets, []);
    const mine = await readWall(owner.id, true);
    assert.deepEqual(mine.widgets, []);
    assert.equal(mine.available?.some((widget) => widget.connection.id === connection.id), false);
    // saving the Wall while it is hidden neither accepts it nor drops its saved widget
    await assert.rejects(saveWall(owner.id, [{ connectionId: connection.id, type: 'mal-recent-anime' }]), ConnectionMutationError);
    await saveWall(owner.id, []);

    await app.inject({ method: 'PATCH', url: `/api/me/connections/${connection.id}`, headers: auth, payload: { showOnProfile: true } });
    const back = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/wall`, headers: await headers(friend.id) });
    assert.equal(back.json().widgets.length, 1);
    const [after] = await db.select().from(users).where(eq(users.id, owner.id));
    assert.deepEqual(after?.profileLinks, [connection.url, 'https://example.com/kept']);

    const bad = await app.inject({ method: 'PATCH', url: `/api/me/connections/${connection.id}`, headers: auth, payload: { showOnProfile: 'no' } });
    assert.equal(bad.statusCode, 400);
    const empty = await app.inject({ method: 'PATCH', url: `/api/me/connections/${connection.id}`, headers: auth, payload: {} });
    assert.equal(empty.statusCode, 400);
  });
  it('validates widget ownership, compatibility and duplicates, and persists ordering', async () => {
    const owner = await makeUser('order'); const another = await makeUser('foreign');
    const connection = await mal(owner.id); const foreign = await mal(another.id);
    await mutateConnection(owner.id, 'create', { provider: 'github', value: 'octocat' });
    const github = (await listConnections(owner.id)).find((row) => row.provider === 'github')!;
    for (const widgets of [[{ connectionId: foreign.id, type: 'mal-recent-anime' }], [{ connectionId: connection.id, type: 'github-calendar' }], [{ connectionId: connection.id, type: 'mal-recent-anime' }, { connectionId: connection.id, type: 'mal-recent-anime' }], [{ connectionId: connection.id, type: 'mal-favorite-anime' }]]) {
      await assert.rejects(saveWall(owner.id, widgets), (error: ConnectionMutationError) => error.code === 'invalid_wall');
    }
    const widgets = [{ connectionId: github.id, type: 'github-profile' }, { connectionId: connection.id, type: 'mal-recent-anime' }];
    await saveWall(owner.id, widgets);
    assert.deepEqual((await readWall(owner.id)).widgets.map((widget) => widget.type), widgets.map((widget) => widget.type));
    await mutateConnection(owner.id, 'delete', {}, connection.id);
    await mutateConnection(owner.id, 'delete', {}, github.id);
    assert.deepEqual(await readWall(owner.id), { widgets: [] });
    assert.equal((await db.select().from(profileWallWidgets).where(eq(profileWallWidgets.connectionId, connection.id))).length, 0);
  });
});

describe('connection sync worker (real Postgres)', () => {
  it('shares the anonymous GitHub request budget across accounts without delaying MAL', async () => {
    const first = await makeUser('ghfirst'); const second = await makeUser('ghsecond'); const other = await makeUser('malqueue');
    await mutateConnection(first.id, 'create', { provider: 'github', value: 'octocat' });
    await mutateConnection(second.id, 'create', { provider: 'github', value: 'octocat' });
    await mal(other.id);
    const now = new Date(Date.now() + 1000);
    let githubRequests = 0;
    const json: RequestJson = async (url) => {
      if (url.startsWith('https://api.github.com/')) { githubRequests++; return githubUserFixture; }
      return request(url);
    };
    await sync({ now, request: json, requestText: async () => githubCalendarFixture() });
    assert.equal(githubRequests, 1);
    assert.ok((await listConnections(other.id))[0]?.syncedAt);
    const [limit] = await db.select().from(connectionSyncLimits).where(eq(connectionSyncLimits.provider, 'github'));
    assert.equal(limit?.nextRequestAt.getTime(), now.getTime() + GITHUB_SYNC_INTERVAL_MS);
    await sync({ now: new Date(now.getTime() + GITHUB_SYNC_INTERVAL_MS - 1), request: json, requestText: async () => githubCalendarFixture() });
    assert.equal(githubRequests, 1);
    await sync({ now: new Date(now.getTime() + GITHUB_SYNC_INTERVAL_MS), request: json, requestText: async () => githubCalendarFixture() });
    assert.equal(githubRequests, 2);
    assert.ok((await listConnections(first.id))[0]?.syncedAt);
    assert.ok((await listConnections(second.id))[0]?.syncedAt);
  });
  it('preserves GitHub snapshots on calendar markup changes and respects provider-wide cooldowns', async () => {
    const owner = await makeUser('ghcache');
    await mutateConnection(owner.id, 'create', { provider: 'github', value: 'octocat' });
    const row = (await listConnections(owner.id))[0]!;
    await db.update(profileConnections).set({ snapshot, syncedAt: new Date() }).where(eq(profileConnections.id, row.id));
    const now = new Date(Date.now() + 1000);
    await sync({ now, request: async () => githubUserFixture, requestText: async () => '<html>changed calendar</html>' });
    let saved = (await listConnections(owner.id))[0]!;
    assert.deepEqual(saved.snapshot, snapshot); assert.equal(saved.syncError, 'invalid_response');
    const later = new Date(now.getTime() + SYNC_INTERVAL_MS + 1);
    await sync({ now: later, request: async () => { throw new ConnectionFetchError('rate_limited', 3_600_000); }, requestText: async () => assert.fail('rate-limited profile must not read HTML') });
    saved = (await listConnections(owner.id))[0]!;
    assert.equal(saved.syncError, 'rate_limited');
    const [limit] = await db.select().from(connectionSyncLimits).where(eq(connectionSyncLimits.provider, 'github'));
    assert.equal(limit?.nextRequestAt.getTime(), later.getTime() + 3_600_000);
    const another = await makeUser('ghpaused');
    await mutateConnection(another.id, 'create', { provider: 'github', value: 'octocat' });
    await sync({ now: new Date(later.getTime() + 60_000), request: async () => assert.fail('GitHub must honor its cooldown') });
    assert.equal((await listConnections(another.id))[0]?.syncedAt, null);
  });

  it('syncs initially, waits twenty-four hours, retains snapshots on failure, and recovers an expired lease', async () => {
    const owner = await makeUser('sync'); const connection = await mal(owner.id);
    const now = new Date(Date.now() + 1000);
    await sync({ request, now });
    let row = (await listConnections(owner.id))[0]!;
    assert.ok(row.snapshot); assert.equal(row.syncedAt?.getTime(), now.getTime());
    assert.equal(row.nextSyncAt.getTime(), now.getTime() + 24 * 60 * 60 * 1000);
    let earlyRequests = 0;
    await sync({ request: async (url) => { earlyRequests++; return request(url); }, now: new Date(now.getTime() + 12 * 60 * 60 * 1000) });
    assert.equal(earlyRequests, 0);
    const old = row.snapshot;
    const due = new Date(now.getTime() + SYNC_INTERVAL_MS + 1);
    await db.update(profileConnections).set({ leaseToken: 'crashed-process', leaseUntil: new Date(due.getTime() - 1) }).where(eq(profileConnections.id, connection.id));
    await sync({ request: async () => { throw new ConnectionFetchError('rate_limited', 300_000); }, now: due });
    row = (await listConnections(owner.id))[0]!;
    assert.deepEqual(row.snapshot, old); assert.equal(row.syncError, 'rate_limited'); assert.equal(row.leaseToken, null);
    assert.equal(row.nextSyncAt.getTime(), due.getTime() + 300_000);
  });
  it('does not claim active leases or run overlapping local drains', async () => {
    const owner = await makeUser('leased'); const connection = await mal(owner.id);
    const now = new Date(Date.now() + 1000);
    await db.update(profileConnections).set({ leaseToken: 'active', leaseUntil: new Date(now.getTime() + 60_000) }).where(eq(profileConnections.id, connection.id));
    await sync({ request: async () => assert.fail('active lease must not be fetched'), now });
    await db.update(profileConnections).set({ leaseToken: null, leaseUntil: null }).where(eq(profileConnections.id, connection.id));
    let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void; const started = new Promise<void>((resolve) => { entered = resolve; });
    const first = sync({ now, request: async (url) => { entered(); await pending; return request(url); } });
    await started;
    await sync({ now, request: async () => assert.fail('must not overlap') });
    release(); await first;
  });
  it('discards results when the username changes or the connection is removed in flight', async () => {
    for (const action of ['edit', 'delete'] as const) {
      const owner = await makeUser('stale'); const connection = await mal(owner.id);
      const now = new Date(Date.now() + 1000);
      let changed = false;
      await sync({ now, request: async (url) => {
        if (!changed) {
          changed = true;
          await mutateConnection(owner.id, action, { value: 'newuser' }, connection.id);
          if (action === 'edit') await db.update(profileConnections).set({ nextSyncAt: new Date('2100-01-01') }).where(eq(profileConnections.id, connection.id));
        }
        return request(url);
      } });
      const rows = await listConnections(owner.id);
      if (action === 'delete') assert.equal(rows.length, 0);
      else { assert.equal(rows[0]?.value, 'newuser'); assert.equal(rows[0]?.snapshot, null); }
    }
  });
  it('preserves a complete snapshot on provider failure and records missing or private profiles', async () => {
    const owner = await makeUser('failure'); const connection = await mal(owner.id);
    await db.update(profileConnections).set({ snapshot, syncedAt: new Date() }).where(eq(profileConnections.id, connection.id));
    for (const code of ['not_found', 'private', 'invalid_response']) {
      const now = new Date();
      await db.update(profileConnections).set({ nextSyncAt: new Date(0) }).where(and(eq(profileConnections.id, connection.id), eq(profileConnections.userId, owner.id)));
      await sync({ now, request: async () => { throw new ConnectionFetchError(code); } });
      const row = (await listConnections(owner.id))[0]!;
      assert.deepEqual(row.snapshot, snapshot); assert.equal(row.syncError, code); assert.equal(row.nextSyncAt.getTime(), now.getTime() + SYNC_INTERVAL_MS);
    }
  });
});

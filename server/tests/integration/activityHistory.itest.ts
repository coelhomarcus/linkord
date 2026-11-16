import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { activityHistory, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { ACTIVITY_HISTORY_MAX, databaseActivityHistoryStore, readActivityHistory } from '../../src/modules/activity/activityHistory.js';
import type { Activity } from '../../src/modules/presence/activity.js';
import { befriend, db, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

async function asUser(userId: string) {
  const token = (await createSession(userId)).rawToken;
  return { cookie: `${config.SESSION_COOKIE}=${token}` };
}

const game = (key: string, name = key, icon: string | null = null): Activity => ({ key, kind: 'playing', name, icon, startedAt: new Date().toISOString() });
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000);

describe('activity history store (real Postgres)', () => {
  it('keeps one row per game, dated by the last time it was seen, newest first', async () => {
    const me = await makeUser('ah');
    await databaseActivityHistoryStore.record(me.id, game('minecraft', 'Minecraft'), minutesAgo(90));
    await databaseActivityHistoryStore.record(me.id, game('steam:570', 'Dota 2'), minutesAgo(30));
    await databaseActivityHistoryStore.record(me.id, game('minecraft', 'Minecraft'), minutesAgo(5));
    const history = await readActivityHistory(me.id);
    assert.equal(history?.sharing, true);
    assert.deepEqual(history?.items.map((i) => i.name), ['Minecraft', 'Dota 2']);
  });

  it('keeps an icon found earlier when a later report has none', async () => {
    const me = await makeUser('ah');
    const icon = `/api/activity/icons/${'b'.repeat(64)}.webp`;
    await databaseActivityHistoryStore.record(me.id, game('minecraft', 'Minecraft', icon), minutesAgo(10));
    await databaseActivityHistoryStore.record(me.id, game('minecraft', 'Minecraft', null), minutesAgo(1));
    assert.equal((await readActivityHistory(me.id))?.items[0]?.icon, icon);
  });

  it(`drops the oldest beyond ${ACTIVITY_HISTORY_MAX} games`, async () => {
    const me = await makeUser('ah');
    for (let i = 0; i <= ACTIVITY_HISTORY_MAX; i++) await databaseActivityHistoryStore.record(me.id, game(`game-${i}`), minutesAgo(100 - i));
    const rows = await db.select().from(activityHistory).where(eq(activityHistory.userId, me.id));
    assert.equal(rows.length, ACTIVITY_HISTORY_MAX);
    assert.ok(!rows.some((r) => r.key === 'game-0'));
  });

  it('shows nothing while sharing is off, and never a game hidden now', async () => {
    const me = await makeUser('ah');
    await databaseActivityHistoryStore.record(me.id, game('minecraft'), minutesAgo(10));
    await databaseActivityHistoryStore.record(me.id, game('steam:570'), minutesAgo(5));
    await db.update(users).set({ hiddenActivities: ['minecraft'] }).where(eq(users.id, me.id));
    assert.deepEqual((await readActivityHistory(me.id))?.items.map((i) => i.key), ['steam:570']);
    await db.update(users).set({ activitySharing: false }).where(eq(users.id, me.id));
    assert.deepEqual(await readActivityHistory(me.id), { sharing: false, items: [] });
  });
});

describe('GET /api/users/:userId/activity (real Postgres)', () => {
  it("returns a friend's history and the same 404 to a stranger as for no account", async () => {
    const owner = await makeUser('ah'); const friend = await makeUser('fr'); const stranger = await makeUser('st');
    await befriend(owner.id, friend.id);
    await databaseActivityHistoryStore.record(owner.id, game('minecraft', 'Minecraft'), minutesAgo(60));

    const ok = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/activity`, headers: await asUser(friend.id) });
    assert.equal(ok.statusCode, 200);
    const body = ok.json() as { sharing: boolean; items: Array<{ key: string; kind: string; name: string; lastPlayedAt: string }> };
    assert.equal(body.sharing, true);
    assert.deepEqual(body.items.map((i) => [i.key, i.kind, i.name]), [['minecraft', 'playing', 'Minecraft']]);

    const denied = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/activity`, headers: await asUser(stranger.id) });
    const missing = await app.inject({ method: 'GET', url: '/api/users/nobody/activity', headers: await asUser(stranger.id) });
    assert.equal(denied.statusCode, 404);
    assert.deepEqual(denied.json(), missing.json());

    const anonymous = await app.inject({ method: 'GET', url: `/api/users/${owner.id}/activity` });
    assert.equal(anonymous.statusCode, 401);
  });
});

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { activitySessions, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { databaseActivityHistoryStore } from '../../src/modules/activity/activityHistory.js';
import {
  ACTIVITY_DAY_MS, closeInterruptedActivitySessions, createActivitySessionTracker,
  databaseActivitySessionStore, exportActivitySessions, pruneActivitySessions,
} from '../../src/modules/activity/activitySessions.js';
import { aggregateActivity, readActivityWidgets } from '../../src/modules/activity/activityWidgets.js';
import type { Activity } from '../../src/modules/presence/activity.js';
import { createIsolatedDatabase } from '../../src/scripts/rehearsal/isolatedDb.js';
import { makeMigrationsFolder } from '../../src/scripts/rehearsal/migrationFolders.js';
import { migrateOn } from '../../src/scripts/rehearsal/migrateOn.js';
import { befriend, db, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

const hour = 3_600_000;
const game = (key: string): Activity => ({ key, kind: 'playing', name: key, icon: null, startedAt: '2020-01-01T00:00:00.000Z' });
async function asUser(userId: string) {
  return { cookie: `${config.SESSION_COOKIE}=${(await createSession(userId)).rawToken}` };
}

test('the migration removes previously saved activity calendars without moving other widgets', async () => {
  const isolated = await createIsolatedDatabase(process.env.TEST_DATABASE_BASE_URL ?? process.env.DATABASE_URL!, 'test', `activity_calendar_${Date.now().toString(36)}`);
  const old = makeMigrationsFolder({ toIdx: 78 });
  const latest = makeMigrationsFolder();
  try {
    await migrateOn(isolated.pool, old.folder);
    await isolated.pool.query("INSERT INTO users (id, username, password_hash) VALUES ('owner', 'owner', 'unused')");
    await isolated.pool.query(`INSERT INTO profile_wall_widgets (id, user_id, type, position) VALUES
      ('top', 'owner', 'activity-top', 0), ('calendar', 'owner', 'activity-calendar', 1), ('summary', 'owner', 'activity-summary', 2)`);
    await migrateOn(isolated.pool, latest.folder);
    const { rows } = await isolated.pool.query('SELECT type, position FROM profile_wall_widgets ORDER BY position');
    assert.deepEqual(rows, [{ type: 'activity-top', position: 0 }, { type: 'activity-summary', position: 2 }]);
  } finally { old.cleanup(); latest.cleanup(); await isolated.drop(); }
});

test('a restart closes at the last observation and an old start reported again cannot count time twice', async () => {
  const user = await makeUser('session');
  const start = Date.now() - 5 * hour;
  let now = start;
  const tracker = () => createActivitySessionTracker(databaseActivitySessionStore, () => new Date(now));
  const first = tracker();
  first.observe(user.id, game('minecraft'));
  now += hour;
  first.checkpoint();
  await first.written();

  now += 2 * hour;
  await closeInterruptedActivitySessions();
  await closeInterruptedActivitySessions();
  const second = tracker();
  second.observe(user.id, game('minecraft'));
  now += hour;
  second.observe(user.id, undefined);
  await second.written();

  const rows = await exportActivitySessions(user.id);
  assert.deepEqual(rows.map(({ startedAt, endedAt }) => [startedAt.getTime(), endedAt?.getTime()]), [
    [start, start + hour], [start + 3 * hour, start + 4 * hour],
  ]);
  const result = await readActivityWidgets(user.id, new Set(['activity-top']), now);
  assert.deepEqual(result?.widget('activity-top', 7), {
    kind: 'activity-top', items: [{ key: 'minecraft', kind: 'playing', name: 'minecraft', icon: null, milliseconds: 2 * hour }],
  });

  await pruneActivitySessions(now + 401 * ACTIVITY_DAY_MS);
  assert.deepEqual(await exportActivitySessions(user.id), []);
});

test('the Wall excludes hidden keys from all aggregates, and sharing off preserves widget settings', async () => {
  const owner = await makeUser('owner');
  const friend = await makeUser('friend');
  await befriend(owner.id, friend.id);
  const now = (Math.floor(Date.now() / ACTIVITY_DAY_MS) - 1) * ACTIVITY_DAY_MS + 16 * hour;
  const row = (key: string, hoursAgo: number, length: number) => ({
    id: crypto.randomUUID(), userId: owner.id, key, name: key, icon: null, kind: 'playing' as const,
    startedAt: new Date(now - hoursAgo * hour), lastSeenAt: new Date(now - (hoursAgo - length) * hour),
    endedAt: new Date(now - (hoursAgo - length) * hour),
  });
  await databaseActivitySessionStore.write([row('minecraft', 10, 5), row('steam:570', 3, 1), row('steam:570', 240, 2)]);
  await databaseActivityHistoryStore.record(owner.id, game('minecraft'), new Date(now));
  await databaseActivityHistoryStore.record(owner.id, game('steam:570'), new Date(now));
  await db.update(users).set({ hiddenActivities: ['minecraft'] }).where(eq(users.id, owner.id));
  const headers = await asUser(owner.id);
  const visitor = await asUser(friend.id);
  const selection = [
    { type: 'activity-top', connectionId: null, period: 7 },
    { type: 'activity-recent', connectionId: null },
    { type: 'activity-summary', connectionId: null, period: 30 },
  ];
  const ownUrl = '/api/me/wall?catalog=2';
  const publicUrl = `/api/users/${owner.id}/wall?catalog=2`;
  const save = (widgets: unknown, url = ownUrl) => app.inject({ method: 'PUT', url, headers, payload: { widgets } });
  const publicWall = async () => (await app.inject({ method: 'GET', url: publicUrl, headers: visitor })).json().widgets;
  assert.equal((await save([{ ...selection[0], period: 8 }])).statusCode, 400);
  // A tab opened before the deploy can still submit its old selection.
  const saved = await save([...selection, { type: 'activity-calendar', connectionId: null }]);
  assert.equal(saved.statusCode, 200);
  assert.ok(saved.json().available.every((widget: { type: string }) => widget.type !== 'activity-calendar'));

  const [top, recent, summary] = await publicWall();
  assert.equal(top.period, 7);
  assert.deepEqual(top.data.items.map((item: { key: string; milliseconds: number }) => [item.key, item.milliseconds]), [['steam:570', hour]]);
  assert.deepEqual(recent.data.items.map((item: { key: string }) => item.key), ['steam:570']);
  assert.deepEqual(summary.data, { kind: 'activity-summary', total: 3 * hour, longestStreak: 1, favorite: 'steam:570' });
  assert.equal(JSON.stringify([top, recent, summary]).includes('minecraft'), false);

  await db.update(users).set({ activitySharing: false }).where(eq(users.id, owner.id));
  assert.deepEqual(await publicWall(), []);
  const editView = (await app.inject({ method: 'GET', url: ownUrl, headers })).json();
  assert.equal(editView.widgets[0].period, 7);
  assert.ok(editView.widgets.every((widget: { hidden: boolean; data: unknown }) => widget.hidden && widget.data === null));

  assert.equal((await save([{ type: 'igdb-favorite-game', connectionId: null }], '/api/me/wall')).statusCode, 200);
  await db.update(users).set({ activitySharing: true }).where(eq(users.id, owner.id));
  assert.deepEqual((await publicWall()).map((widget: { type: string }) => widget.type), [...selection.map(({ type }) => type), 'igdb-favorite-game']);

  const stranger = await makeUser('stranger');
  const forbidden = await app.inject({ method: 'GET', url: publicUrl, headers: await asUser(stranger.id) });
  assert.equal(forbidden.statusCode, 404);

  await db.delete(users).where(eq(users.id, owner.id));
  assert.deepEqual(await db.select().from(activitySessions).where(eq(activitySessions.userId, owner.id)), []);
});

test('duration is clipped to the period and a session across midnight counts toward both days of the streak', () => {
  const midnight = Date.parse('2026-11-23T00:00:00Z');
  const result = aggregateActivity([{
    key: 'minecraft', name: 'Minecraft', kind: 'playing', icon: null,
    startedAt: new Date(midnight - 4 * hour), lastSeenAt: new Date(midnight + 3 * hour),
  }], midnight - hour, midnight + 2 * hour);
  assert.equal(result.total, 3 * hour);
  assert.equal(result.longestStreak, 2);
});

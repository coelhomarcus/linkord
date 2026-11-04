import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { servers, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { listSharedServers } from '../../src/modules/servers/serversRepository.js';
import { friendsSince, listMutualFriends } from '../../src/modules/friendships/friendshipsRepository.js';
import { befriend, db, makeServerWithMembers, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

async function asUser(userId: string) {
  const token = (await createSession(userId)).rawToken;
  return { cookie: `${config.SESSION_COOKIE}=${token}` };
}

describe('mutual friends (real Postgres)', () => {
  it('lists only the friends both have, by name, never the two accounts themselves', async () => {
    const me = await makeUser('me'); const other = await makeUser('ot');
    const both1 = await makeUser('zeta'); const both2 = await makeUser('alfa');
    const onlyMine = await makeUser('mine'); const onlyTheirs = await makeUser('theirs');
    await befriend(me.id, other.id);
    for (const f of [both1, both2, onlyMine]) await befriend(me.id, f.id);
    for (const f of [both1, both2, onlyTheirs]) await befriend(other.id, f.id);

    const mutual = await listMutualFriends(me.id, other.id, 100);
    assert.deepEqual(mutual.items.map((u) => u.username), [both2.username, both1.username]);
    assert.equal(mutual.total, 2);
  });

  it('stops the list at the limit and still reports the full count', async () => {
    const me = await makeUser('me'); const other = await makeUser('ot');
    for (let i = 0; i < 3; i++) { const f = await makeUser('both'); await befriend(me.id, f.id); await befriend(other.id, f.id); }
    const mutual = await listMutualFriends(me.id, other.id, 2);
    assert.equal(mutual.items.length, 2);
    assert.equal(mutual.total, 3);
  });
});

describe('shared servers (real Postgres)', () => {
  it('lists the active servers both are in, with their member count, and none of the others', async () => {
    const me = await makeUser('me'); const other = await makeUser('ot'); const third = await makeUser('th');
    const shared = await makeServerWithMembers(me.id, [other.id, third.id], 'Bravo');
    await makeServerWithMembers(me.id, [third.id], 'only mine');
    await makeServerWithMembers(other.id, [third.id], 'only theirs');
    const suspended = await makeServerWithMembers(other.id, [me.id], 'suspended');
    await db.update(servers).set({ status: 'suspended' }).where(eq(servers.id, suspended.serverId));
    const alsoShared = await makeServerWithMembers(other.id, [me.id], 'alfa');

    const result = await listSharedServers(me.id, other.id, 100);
    assert.deepEqual(result.items.map((g) => g.id), [alsoShared.serverId, shared.serverId]);
    assert.equal(result.items[1]!.memberCount, 3);
    assert.equal(result.total, 2);
  });

  it('a direct conversation is not a server in common', async () => {
    const me = await makeUser('me'); const other = await makeUser('ot');
    const { getOrCreateDirect } = await import('../../src/modules/conversations/conversationsRepository.js');
    await getOrCreateDirect(me.id, other.id, me.id);
    assert.deepEqual(await listSharedServers(me.id, other.id, 100), { items: [], total: 0 });
  });
});

describe('friends since (real Postgres)', () => {
  it('is the moment the friendship was accepted, and null between non-friends', async () => {
    const me = await makeUser('me'); const friend = await makeUser('fr'); const stranger = await makeUser('st');
    const before = Date.now();
    await befriend(me.id, friend.id);
    const since = await friendsSince(me.id, friend.id);
    assert.ok(since && since.getTime() >= before - 1000);
    assert.equal(await friendsSince(me.id, stranger.id), null);
  });
});

describe('GET /api/users/:userId/profile-details (real Postgres)', () => {
  it('sends member-since, friends-since and what the two have in common', async () => {
    const me = await makeUser('me'); const other = await makeUser('ot'); const both = await makeUser('both');
    await befriend(me.id, other.id); await befriend(me.id, both.id); await befriend(other.id, both.id);
    const { serverId } = await makeServerWithMembers(me.id, [other.id], 'shared');
    const [row] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, other.id));

    const res = await app.inject({ method: 'GET', url: `/api/users/${other.id}/profile-details`, headers: await asUser(me.id) });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.memberSince, row!.createdAt.toISOString());
    assert.ok(typeof body.friendsSince === 'string');
    assert.deepEqual(body.mutualFriends.items.map((u: { id: string }) => u.id), [both.id]);
    assert.deepEqual(body.mutualServers.items.map((g: { id: string }) => g.id), [serverId]);
  });

  it('on your own profile: member-since only, nothing in common with yourself', async () => {
    const me = await makeUser('me');
    const res = await app.inject({ method: 'GET', url: `/api/users/${me.id}/profile-details`, headers: await asUser(me.id) });
    assert.equal(res.statusCode, 200);
    const body = res.json() as Record<string, unknown>;
    assert.ok(typeof body.memberSince === 'string');
    assert.deepEqual({ ...body, memberSince: 'x' }, { memberSince: 'x', friendsSince: null, mutualFriends: { items: [], total: 0 }, mutualServers: { items: [], total: 0 } });
  });

  it('a stranger gets the same 404 as an account that does not exist, and no session gets 401', async () => {
    const me = await makeUser('me'); const stranger = await makeUser('st');
    const headers = await asUser(me.id);
    const denied = await app.inject({ method: 'GET', url: `/api/users/${stranger.id}/profile-details`, headers });
    const missing = await app.inject({ method: 'GET', url: '/api/users/00000000-0000-0000-0000-000000000000/profile-details', headers });
    assert.equal(denied.statusCode, 404);
    assert.deepEqual(denied.json(), missing.json());
    assert.equal((await app.inject({ method: 'GET', url: `/api/users/${stranger.id}/profile-details` })).statusCode, 401);
  });
});

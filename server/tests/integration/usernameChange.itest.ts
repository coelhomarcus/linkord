import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { adminAuditLogs, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createSession } from '../../src/modules/auth/session.js';
import { updateUsername } from '../../src/modules/auth/accounts.js';
import { cleanupParticipant, db, joinNew, pool } from './helpers.js';

// Renaming an account from settings against the real database: the availability check, the change itself
// and the unique index on lower(username) that settles a race between two accounts.

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

const PASSWORD = 'correct horse battery';
const freshIp = () => `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`;
/** A name nobody has, within the 20-character limit. */
const freshName = (prefix = 'un') => `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

async function makeAccount(displayName = '') {
  const id = crypto.randomUUID();
  const username = freshName();
  await db.insert(users).values({ id, username, email: `${username}@example.test`, displayName, passwordHash: await hashPassword(PASSWORD) });
  const { rawToken } = await createSession(id);
  return { id, username, cookie: `${config.SESSION_COOKIE}=${rawToken}` };
}

interface Reply { status: number; body: any }

async function call(method: 'GET' | 'POST', url: string, opts: { payload?: Record<string, unknown>; cookie?: string } = {}): Promise<Reply> {
  const ip = freshIp();
  const res = await app.inject({
    method, url, payload: opts.payload, remoteAddress: ip,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), 'x-forwarded-for': ip },
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

const check = (cookie: string, username: string) => call('GET', `/api/auth/username/availability?username=${encodeURIComponent(username)}`, { cookie });
const rename = (cookie: string, username: string, password = PASSWORD) => call('POST', '/api/auth/username', { cookie, payload: { username, password } });
const login = (username: string) => call('POST', '/api/auth/login', { payload: { username, password: PASSWORD } });

describe('username availability', () => {
  it('needs a session', async () => {
    const res = await call('GET', '/api/auth/username/availability?username=someone');
    assert.equal(res.status, 401);
  });

  it('reports a free name as available', async () => {
    const me = await makeAccount();
    const res = await check(me.cookie, freshName());
    assert.equal(res.status, 200);
    assert.equal(res.body.available, true);
    assert.equal(res.body.current, false);
  });

  it("reports another account's name as taken in any letter case", async () => {
    const me = await makeAccount();
    const other = await makeAccount();
    for (const name of [other.username, other.username.toUpperCase(), other.username[0]!.toUpperCase() + other.username.slice(1)]) {
      const res = await check(me.cookie, name);
      assert.equal(res.status, 200);
      assert.equal(res.body.available, false, name);
    }
  });

  it('never reports the account\'s own name as taken, and says when it is unchanged', async () => {
    const me = await makeAccount();
    const same = await check(me.cookie, me.username);
    assert.equal(same.body.available, true);
    assert.equal(same.body.current, true);
    const recased = await check(me.cookie, me.username.toUpperCase());
    assert.equal(recased.body.available, true);
    assert.equal(recased.body.current, false, 'a change of letter case is a rename');
  });

  it('reports the group mentions as taken', async () => {
    const me = await makeAccount();
    assert.equal((await check(me.cookie, 'Everyone')).body.available, false);
  });

  it('refuses a malformed name with the registration rule', async () => {
    const me = await makeAccount();
    for (const name of ['ab', 'a'.repeat(config.MAX_USERNAME_LEN + 1), 'ana lima', 'joão']) {
      const res = await check(me.cookie, name);
      assert.equal(res.status, 400, name);
      assert.equal(res.body.error.code, 'invalid_username');
    }
  });

  it('is rate limited per account', async () => {
    const me = await makeAccount();
    let limited: Reply | null = null;
    for (let i = 0; i < 40 && !limited; i += 1) {
      const res = await check(me.cookie, freshName());
      if (res.status === 429) limited = res;
      else assert.equal(res.status, 200);
    }
    assert.ok(limited, 'a burst of checks should be cut off');
    assert.equal(limited.body.error.code, 'rate_limited');
    // another account is not affected
    const other = await makeAccount();
    assert.equal((await check(other.cookie, freshName())).status, 200);
  });
});

describe('username change', () => {
  it('renames the account, keeps the session and the display name, and signs in by the new name', async () => {
    const me = await makeAccount('Ana Lima');
    const next = freshName('new');
    const res = await rename(me.cookie, next);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, next);

    const meAfter = await call('GET', '/api/auth/me', { cookie: me.cookie });
    assert.equal(meAfter.status, 200, 'the session stays valid');
    assert.equal(meAfter.body.user.username, next);
    const [row] = await db.select().from(users).where(eq(users.id, me.id));
    assert.equal(row!.displayName, 'Ana Lima');

    assert.equal((await login(next)).status, 200);
    assert.equal((await login(me.username)).status, 401, 'the old name no longer signs in');

    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, me.id), eq(adminAuditLogs.action, 'account.username_change')));
    assert.equal(trail.length, 1);
    assert.deepEqual(trail[0]!.detail, { from: me.username, to: next });
  });

  it('changes only the letter case of its own name', async () => {
    const me = await makeAccount();
    const res = await rename(me.cookie, me.username.toUpperCase());
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, me.username.toUpperCase());
  });

  it('tells live connections of the account about the new name', async () => {
    const me = await makeAccount();
    const tab = joinNew(me);
    try {
      const next = freshName('live');
      assert.equal((await rename(me.cookie, next)).status, 200);
      assert.equal(tab.participant.name, next);
      const update = tab.sent.find((m) => m.event === 'participant-updated' && m.payload.participant.userId === me.id);
      assert.equal(update?.payload.participant.name, next);
    } finally {
      cleanupParticipant(tab.participant);
    }
  });

  it('asks for the current password before anything else', async () => {
    const me = await makeAccount();
    const other = await makeAccount();
    const res = await rename(me.cookie, other.username, 'wrong password');
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'invalid_password', 'a taken name is not revealed without the password');
    const [row] = await db.select().from(users).where(eq(users.id, me.id));
    assert.equal(row!.username, me.username);
  });

  it('refuses a malformed name', async () => {
    const me = await makeAccount();
    const res = await rename(me.cookie, 'no spaces allowed');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_username');
  });

  it("refuses another account's name in any letter case", async () => {
    const me = await makeAccount();
    const other = await makeAccount();
    const res = await rename(me.cookie, other.username.toUpperCase());
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'username_taken');
  });

  it('accepts the current name as is, without a change', async () => {
    const me = await makeAccount();
    const res = await rename(me.cookie, me.username);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.username, me.username);
  });

  it('a write that loses the race to the unique index is reported as taken', async () => {
    const me = await makeAccount();
    const other = await makeAccount();
    // as if `other` took the name between the route's check and this write
    await assert.rejects(updateUsername(me.id, other.username.toUpperCase()), (err: { code?: string }) => err.code === 'username_taken');
    const [row] = await db.select().from(users).where(eq(users.id, me.id));
    assert.equal(row!.username, me.username);
  });

  it('two accounts saving the same name at once: one wins, the other gets 409 username_taken', async () => {
    const a = await makeAccount();
    const b = await makeAccount();
    const wanted = freshName('race');
    const results = await Promise.all([rename(a.cookie, wanted), rename(b.cookie, wanted.toUpperCase())]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    assert.equal(loser.body.error.code, 'username_taken');
  });
});

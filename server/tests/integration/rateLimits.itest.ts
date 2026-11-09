import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, describe, it, mock } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { rateLimitWindows, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createSession } from '../../src/modules/auth/session.js';
import {
  FAILURE_RULE, RateLimitUnavailableError, checkBlocked, consume, recordFailure, reset, sweepExpiredRateLimits,
} from '../../src/modules/auth/ratelimit.js';
import { checkRegistrationAllowed } from '../../src/modules/auth/registrationLimits.js';
import { db, makeUser, pool } from './helpers.js';

// The limits that guard against brute force live in Postgres, so these run against the real thing.
// "Restarting" the server here means building a second app from scratch: the counters are not kept in
// any module memory, so the rows are the only thing that can carry a block from one app to the next.

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });
afterEach(() => mock.restoreAll());

const uid = () => crypto.randomUUID();
const keyHash = (key: string) => crypto.createHash('sha256').update(key).digest('hex');
const rowOf = async (key: string) => (await db.select().from(rateLimitWindows).where(eq(rateLimitWindows.key, keyHash(key))))[0];
const ago = (ms: number) => new Date(Date.now() - ms);

/** Pretends the window of `key` ended a minute ago, which is all the passing of time does to a row. */
const expireWindow = (key: string) => db.update(rateLimitWindows)
  .set({ windowEndsAt: ago(60_000), blockedUntil: ago(60_000) })
  .where(eq(rateLimitWindows.key, keyHash(key)));

/** A private-range address nobody else in the run uses, so counters never collide. */
const freshIp = () => `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`;

async function post(instance: FastifyInstance, url: string, payload: Record<string, unknown>, ip: string) {
  const res = await instance.inject({ method: 'POST', url, payload, headers: { 'x-forwarded-for': ip }, remoteAddress: ip });
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null };
}
const login = (instance: FastifyInstance, username: string, password: string, ip: string) =>
  post(instance, '/api/auth/login', { username, password }, ip);

describe('attempt counters', () => {
  it('blocks after the ceiling and reports the seconds left', async () => {
    const key = `t:${uid()}`;
    for (let i = 0; i < FAILURE_RULE.max - 1; i++) await recordFailure(key);
    assert.equal(await checkBlocked(key), null);

    await recordFailure(key);
    const seconds = await checkBlocked(key);
    assert.ok(seconds !== null && seconds > 0 && seconds <= FAILURE_RULE.windowMs / 1000);
  });

  it('keeps keys apart', async () => {
    const a = `t:${uid()}`;
    const b = `t:${uid()}`;
    for (let i = 0; i < FAILURE_RULE.max; i++) await recordFailure(a);
    assert.notEqual(await checkBlocked(a), null);
    assert.equal(await checkBlocked(b), null);
  });

  it('reset unblocks, and resetting a key that never failed is harmless', async () => {
    const key = `t:${uid()}`;
    for (let i = 0; i < FAILURE_RULE.max; i++) await recordFailure(key);
    await reset(key);
    assert.equal(await checkBlocked(key), null);
    assert.equal(await rowOf(key), undefined);
    await reset(`t:${uid()}`);
  });

  it('stores a hash, never the key itself', async () => {
    const key = `recovery-email:${uid()}@example.com`;
    await recordFailure(key);
    assert.equal((await rowOf(key))?.count, 1);
    const stored = await db.select({ key: rateLimitWindows.key }).from(rateLimitWindows).where(eq(rateLimitWindows.key, key));
    assert.deepEqual(stored, []);
  });

  it('a block ends with its window, and the next failure opens a fresh window', async () => {
    const key = `t:${uid()}`;
    for (let i = 0; i < FAILURE_RULE.max; i++) await recordFailure(key);
    assert.notEqual(await checkBlocked(key), null);

    await expireWindow(key);
    assert.equal(await checkBlocked(key), null);

    await recordFailure(key);
    const row = await rowOf(key);
    assert.equal(row?.count, 1);
    assert.equal(row?.blockedUntil, null);
    assert.ok(row!.windowEndsAt.getTime() > Date.now());
  });

  it('attempts past the ceiling do not extend the block', async () => {
    const key = `t:${uid()}`;
    for (let i = 0; i < FAILURE_RULE.max; i++) await recordFailure(key);
    const before = (await rowOf(key))!.blockedUntil!.getTime();
    for (let i = 0; i < 5; i++) await recordFailure(key);
    assert.equal((await rowOf(key))!.blockedUntil!.getTime(), before);
  });

  it('consume allows exactly the ceiling, even when the calls arrive together', async () => {
    const key = `t:${uid()}`;
    const rule = { windowMs: 60_000, max: 5 };
    const results = await Promise.all(Array.from({ length: 12 }, () => consume(key, rule)));
    assert.equal(results.filter((r) => r.allowed).length, 5);
    const refused = results.find((r) => !r.allowed);
    assert.ok(refused && !refused.allowed && refused.retryAfterSec >= 1 && refused.retryAfterSec <= 60);
  });

  it('consume starts over once its window is over', async () => {
    const key = `t:${uid()}`;
    const rule = { windowMs: 60_000, max: 2 };
    await consume(key, rule);
    await consume(key, rule);
    assert.equal((await consume(key, rule)).allowed, false);
    await expireWindow(key);
    assert.equal((await consume(key, rule)).allowed, true);
  });
});

describe('sweep of expired windows', () => {
  it('removes the rows whose window is over and keeps the live ones', async () => {
    const dead = `t:${uid()}`;
    const live = `t:${uid()}`;
    await recordFailure(dead);
    await recordFailure(live);
    await expireWindow(dead);

    const removed = await sweepExpiredRateLimits();
    assert.ok(removed >= 1);
    assert.equal(await rowOf(dead), undefined);
    assert.equal((await rowOf(live))?.count, 1);
  });

  it('keeps a row that is still blocked', async () => {
    const key = `t:${uid()}`;
    for (let i = 0; i < FAILURE_RULE.max; i++) await recordFailure(key);
    await sweepExpiredRateLimits();
    assert.notEqual(await checkBlocked(key), null);
  });
});

describe('login through a restart', () => {
  it('stays blocked after the server restarts, even with the right password', async () => {
    const username = `rl_${uid().slice(0, 12)}`;
    const password = 'correct horse battery';
    await db.insert(users).values({ id: uid(), username, passwordHash: await hashPassword(password) });
    const ip = freshIp();

    for (let i = 0; i < FAILURE_RULE.max; i++) assert.equal((await login(app, username, 'wrong', ip)).status, 401);
    assert.equal((await login(app, username, 'wrong', ip)).status, 429);

    const restarted = createApp();
    await restarted.ready();
    try {
      // the same account from another address: only the per-account counter can stop this one
      const other = await login(restarted, username, password, freshIp());
      assert.equal(other.status, 429);
      assert.equal(other.body.error.code, 'rate_limited');
      assert.ok(Number(other.headers['retry-after']) > 0);

      const sameIp = await login(restarted, username, password, ip);
      assert.equal(sameIp.status, 429);
    } finally {
      await restarted.close();
    }
  });

  it('blocks an address across accounts after a restart', async () => {
    const ip = freshIp();
    for (let i = 0; i < FAILURE_RULE.max; i++) await login(app, `ghost_${uid().slice(0, 10)}`, 'x', ip);

    const restarted = createApp();
    await restarted.ready();
    try {
      assert.equal((await login(restarted, `ghost_${uid().slice(0, 10)}`, 'x', ip)).status, 429);
    } finally {
      await restarted.close();
    }
  });

  it('a successful login clears the counters', async () => {
    const username = `rl_${uid().slice(0, 12)}`;
    const password = 'correct horse battery';
    await db.insert(users).values({ id: uid(), username, passwordHash: await hashPassword(password) });
    const ip = freshIp();

    for (let i = 0; i < 3; i++) await login(app, username, 'wrong', ip);
    assert.equal((await rowOf(`user:${username}`))?.count, 3);
    assert.equal((await login(app, username, password, ip)).status, 200);
    assert.equal(await rowOf(`user:${username}`), undefined);
    assert.equal(await rowOf(`ip:${ip}`), undefined);
  });
});

describe('other limits moved to the database', () => {
  it('recovery requests: the eleventh in a window is refused, also after a restart', async () => {
    const ip = freshIp();
    const username = `ghost_${uid().slice(0, 10)}`;
    for (let i = 0; i < FAILURE_RULE.max; i++) assert.equal((await post(app, '/api/auth/recovery/request', { username }, ip)).status, 200);

    const restarted = createApp();
    await restarted.ready();
    try {
      const refused = await post(restarted, '/api/auth/recovery/request', { username }, ip);
      assert.equal(refused.status, 429);
      assert.ok(Number(refused.headers['retry-after']) > 0);
    } finally {
      await restarted.close();
    }
  });

  it('wrong invite codes block the address', async () => {
    const saved = config.REGISTRATION_CODE;
    config.REGISTRATION_CODE = 'the-real-code';
    try {
      const ip = freshIp();
      const attempt = () => post(app, '/api/auth/register', { username: 'x', email: 'x@example.com', password: 'whatever12345', confirmPassword: 'whatever12345', code: 'nope' }, ip);
      for (let i = 0; i < FAILURE_RULE.max; i++) assert.equal((await attempt()).status, 403);
      assert.equal((await attempt()).status, 429);
    } finally {
      config.REGISTRATION_CODE = saved;
    }
  });

  it('sign-ups per address: the cap holds until the window ends', async () => {
    const saved = config.MAX_NEW_ACCOUNTS_PER_HOUR;
    // other tests create accounts too; this one is about the per-address cap
    config.MAX_NEW_ACCOUNTS_PER_HOUR = 1_000_000;
    try {
      const ip = freshIp();
      for (let i = 0; i < config.REGISTRATIONS_PER_IP_PER_HOUR; i++) assert.equal(await checkRegistrationAllowed(ip), 'ok');
      assert.equal(await checkRegistrationAllowed(ip), 'ip_limited');
      await expireWindow(`register:${ip}`);
      assert.equal(await checkRegistrationAllowed(ip), 'ok');
    } finally {
      config.MAX_NEW_ACCOUNTS_PER_HOUR = saved;
    }
  });

  it('email change requests are limited per account', async () => {
    const user = await makeUser('ec');
    const password = 'correct horse battery';
    await db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, user.id));
    const cookie = `${config.SESSION_COOKIE}=${(await createSession(user.id)).rawToken}`;
    const request = () => app.inject({ method: 'POST', url: '/api/auth/email/change/request', payload: { email: `new_${uid().slice(0, 8)}@example.com`, password }, headers: { cookie } });
    // the mail itself is not configured here (503 email_unavailable), but the attempt is still counted
    for (let i = 0; i < FAILURE_RULE.max; i++) await request();
    assert.equal((await request()).statusCode, 429);
    await db.delete(rateLimitWindows).where(inArray(rateLimitWindows.key, [keyHash(`email-change:${user.id}`)]));
  });
});

describe('when the database cannot answer', () => {
  const down = () => mock.method(db, 'execute', async () => { throw new Error('connection refused'); });

  it('the counters throw instead of allowing', async () => {
    down();
    await assert.rejects(checkBlocked(`t:${uid()}`), RateLimitUnavailableError);
    await assert.rejects(recordFailure(`t:${uid()}`), RateLimitUnavailableError);
    await assert.rejects(consume(`t:${uid()}`, { windowMs: 1000, max: 1 }), RateLimitUnavailableError);
    await assert.rejects(reset(`t:${uid()}`), RateLimitUnavailableError);
  });

  it('login is refused with a clear 503, not let through', async () => {
    const username = `rl_${uid().slice(0, 12)}`;
    const password = 'correct horse battery';
    await db.insert(users).values({ id: uid(), username, passwordHash: await hashPassword(password) });
    down();

    const res = await login(app, username, password, freshIp());
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'rate_limit_unavailable');
    assert.match(res.body.error.message, /tentativas/);
    assert.ok(Number(res.headers['retry-after']) > 0);
    assert.equal(res.headers['set-cookie'], undefined);
  });

  it('registration and recovery are refused too', async () => {
    down();
    const ip = freshIp();
    assert.equal((await post(app, '/api/auth/register', { code: 'x' }, ip)).status, 503);
    assert.equal((await post(app, '/api/auth/recovery/request', { username: 'someone' }, ip)).status, 503);
  });
});

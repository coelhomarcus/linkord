import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { adminAuditLogs, authCodes, rateLimitWindows, sessions, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createSession, resolveSession, sweepExpiredSessions, touchSessions } from '../../src/modules/auth/session.js';
import { FAILURE_RULE } from '../../src/modules/auth/ratelimit.js';
import { participants } from '../../src/modules/presence/participants.js';
import { db, joinNew, pool } from './helpers.js';

// The account's own security controls against the real database: two-step login by email, the session
// list and its revocations (sockets included), idle expiry and the password change.

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

const PASSWORD = 'correct horse battery';
const uid = () => crypto.randomUUID();
const tokenHashOf = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
const freshIp = () => `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every email the app hands to Resend in a test, read back for its code. */
let mailbox: { to: string[]; subject: string; text: string }[] = [];
const saved = { key: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL, idle: config.SESSION_IDLE_DAYS };

beforeEach(() => {
  mailbox = [];
  config.RESEND_API_KEY = 're_test';
  config.RESEND_FROM_EMAIL = 'Linkord <noreply@example.test>';
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    mailbox.push(JSON.parse(String(init.body)));
    return new Response('{}', { status: 200 });
  });
});
afterEach(() => {
  mock.restoreAll();
  config.RESEND_API_KEY = saved.key;
  config.RESEND_FROM_EMAIL = saved.from;
  config.SESSION_IDLE_DAYS = saved.idle;
});

function lastCode(): string {
  const mail = mailbox.at(-1);
  assert.ok(mail, 'an email should have been sent');
  const match = mail.text.match(/\b(\d{6})\b/);
  assert.ok(match, 'the email should carry a 6-digit code');
  return match[1]!;
}

/** A code that is surely not the one in the mailbox. */
const wrongCode = (right: string) => (right === '000000' ? '111111' : '000000');

async function makeAccount(opts: { twoFactor?: boolean; email?: boolean } = {}) {
  const id = uid();
  const username = `sec_${id.slice(0, 8)}`;
  const email = opts.email === false ? null : `${username}@example.test`;
  await db.insert(users).values({ id, username, email, passwordHash: await hashPassword(PASSWORD), twoFactorEmail: opts.twoFactor ?? false });
  return { id, username, email };
}

interface Reply { status: number; headers: Record<string, unknown>; body: any; cookie: string | null }

async function call(method: 'GET' | 'POST' | 'DELETE', url: string, opts: { payload?: Record<string, unknown>; cookie?: string; ip?: string; ua?: string } = {}): Promise<Reply> {
  const ip = opts.ip ?? freshIp();
  const res = await app.inject({
    method, url, payload: opts.payload, remoteAddress: ip,
    headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.ua ? { 'user-agent': opts.ua } : {}), 'x-forwarded-for': ip },
  });
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return {
    status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null,
    cookie: raw ? raw.split(';')[0]! : null,
  };
}

const login = (username: string, password = PASSWORD, ip?: string) => call('POST', '/api/auth/login', { payload: { username, password }, ip });
const verify = (challenge: string, code: string, ip?: string) => call('POST', '/api/auth/login/verify', { payload: { challenge, code }, ip });
const cookieFor = async (userId: string, origin?: { ip: string; userAgent: string }) => {
  const { rawToken } = await createSession(userId, origin);
  return { cookie: `${config.SESSION_COOKIE}=${rawToken}`, tokenHash: tokenHashOf(rawToken), rawToken };
};
const me = (cookie: string) => call('GET', '/api/auth/me', { cookie });

/** A connected tab of `user` opened with the session behind `tokenHash`, recording what reaches it. */
function connectedTab(user: { id: string; username: string }, tokenHash: string) {
  const tab = joinNew(user);
  (tab.socket.user as { tokenHash: string }).tokenHash = tokenHash;
  let disconnected = false;
  (tab.socket as unknown as { disconnect: () => void }).disconnect = () => { disconnected = true; };
  return { ...tab, get disconnected() { return disconnected; } };
}

describe('two-step login', () => {
  it('a right password only earns a challenge; the emailed code finishes the login', async () => {
    const user = await makeAccount({ twoFactor: true });
    const first = await login(user.username);
    assert.equal(first.status, 200);
    assert.equal(first.cookie, null, 'no session before the code');
    assert.equal(first.body.user, undefined);
    assert.match(first.body.twoFactor.challenge, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first.body.twoFactor.email, user.email, 'the address is masked');
    assert.deepEqual(mailbox.at(-1)?.to, [user.email]);

    const code = lastCode();
    const wrong = await verify(first.body.twoFactor.challenge, wrongCode(code));
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'invalid_code');
    assert.equal(wrong.cookie, null);

    const done = await verify(first.body.twoFactor.challenge, code);
    assert.equal(done.status, 200);
    assert.equal(done.body.user.id, user.id);
    assert.ok(done.cookie);
    assert.equal((await me(done.cookie!)).status, 200);

    // the challenge is spent: the same code cannot open a second session
    assert.equal((await verify(first.body.twoFactor.challenge, code)).status, 400);
  });

  it('a wrong password never reaches the code step', async () => {
    const user = await makeAccount({ twoFactor: true });
    const res = await login(user.username, 'not the password');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'invalid_credentials');
    assert.equal(mailbox.length, 0);
  });

  it('an expired code is refused', async () => {
    const user = await makeAccount({ twoFactor: true });
    const { body } = await login(user.username);
    const code = lastCode();
    await db.update(authCodes).set({ expiresAt: new Date(Date.now() - 1000) }).where(and(eq(authCodes.userId, user.id), eq(authCodes.purpose, 'login')));
    const res = await verify(body.twoFactor.challenge, code);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'code_expired');
  });

  it('a code dies after its attempts run out, even when the right one comes next', async () => {
    const user = await makeAccount({ twoFactor: true });
    const { body } = await login(user.username);
    const code = lastCode();
    let last: Reply | null = null;
    for (let i = 0; i < config.AUTH_CODE_MAX_ATTEMPTS; i++) last = await verify(body.twoFactor.challenge, wrongCode(code));
    assert.equal(last!.body.error.code, 'too_many_attempts');
    assert.equal((await verify(body.twoFactor.challenge, code)).status, 400);
  });

  it('wrong codes across resends block the account in the database', async () => {
    const user = await makeAccount({ twoFactor: true });
    const { body } = await login(user.username);
    const challenge = body.twoFactor.challenge as string;
    for (let i = 0; i < config.AUTH_CODE_MAX_ATTEMPTS; i++) await verify(challenge, wrongCode(lastCode()));

    assert.equal((await call('POST', '/api/auth/login/resend', { payload: { challenge } })).status, 200);
    const fresh = lastCode();
    for (let i = config.AUTH_CODE_MAX_ATTEMPTS; i < FAILURE_RULE.max; i++) await verify(challenge, wrongCode(fresh));

    const blocked = await verify(challenge, fresh);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
  });

  it('a resend replaces the code; the old one stops working', async () => {
    const user = await makeAccount({ twoFactor: true });
    const { body } = await login(user.username);
    const old = lastCode();
    await call('POST', '/api/auth/login/resend', { payload: { challenge: body.twoFactor.challenge } });
    const fresh = lastCode();
    if (fresh !== old) assert.equal((await verify(body.twoFactor.challenge, old)).status, 400);
    assert.equal((await verify(body.twoFactor.challenge, fresh)).status, 200);
  });

  it('two logins of the same account each keep their own code', async () => {
    const user = await makeAccount({ twoFactor: true });
    const a = await login(user.username);
    const codeA = lastCode();
    const b = await login(user.username);
    const codeB = lastCode();
    assert.equal((await verify(a.body.twoFactor.challenge, codeA)).status, 200);
    assert.equal((await verify(b.body.twoFactor.challenge, codeB)).status, 200);
  });

  it('a challenge past its lifetime asks for the password again', async () => {
    const user = await makeAccount({ twoFactor: true });
    const { body } = await login(user.username);
    const code = lastCode();
    await db.update(authCodes).set({ createdAt: new Date(Date.now() - 31 * 60 * 1000) }).where(eq(authCodes.userId, user.id));
    const res = await verify(body.twoFactor.challenge, code);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'login_expired');
    assert.equal((await verify('A'.repeat(43), code)).body.error.code, 'login_expired');
  });

  it('without email delivery the login cannot finish, and says so instead of skipping the code', async () => {
    const user = await makeAccount({ twoFactor: true });
    config.RESEND_API_KEY = '';
    const res = await login(user.username);
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'email_unavailable');
    assert.equal(res.cookie, null);
  });

  it('the session it opens records where the login came from', async () => {
    const user = await makeAccount({ twoFactor: true });
    const ip = freshIp();
    const { body } = await login(user.username, PASSWORD, ip);
    const done = await call('POST', '/api/auth/login/verify', { payload: { challenge: body.twoFactor.challenge, code: lastCode() }, ip, ua: 'TestBrowser/1.0' });
    const [row] = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    assert.equal(done.status, 200);
    assert.equal(row?.ip, ip);
    assert.equal(row?.userAgent, 'TestBrowser/1.0');
  });
});

describe('turning two-step login on and off', () => {
  it('needs the password and a code sent to the account email, and leaves a trail', async () => {
    const user = await makeAccount();
    const { cookie } = await cookieFor(user.id);

    const wrong = await call('POST', '/api/auth/two-factor/enable/request', { cookie, payload: { password: 'nope' } });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error.code, 'invalid_password');
    assert.equal(mailbox.length, 0);

    assert.equal((await call('POST', '/api/auth/two-factor/enable/request', { cookie, payload: { password: PASSWORD } })).status, 200);
    assert.deepEqual(mailbox.at(-1)?.to, [user.email]);
    const code = lastCode();
    assert.equal((await call('POST', '/api/auth/two-factor/enable/confirm', { cookie, payload: { code: wrongCode(code) } })).status, 400);
    const on = await call('POST', '/api/auth/two-factor/enable/confirm', { cookie, payload: { code } });
    assert.equal(on.status, 200);
    assert.equal(on.body.twoFactorEnabled, true);
    assert.equal((await call('GET', '/api/auth/security', { cookie })).body.twoFactorEnabled, true);

    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, user.id), eq(adminAuditLogs.action, 'account.two_factor_enable')));
    assert.equal(trail.length, 1);

    assert.equal((await call('POST', '/api/auth/two-factor/disable', { cookie, payload: { password: 'nope' } })).status, 403);
    const off = await call('POST', '/api/auth/two-factor/disable', { cookie, payload: { password: PASSWORD } });
    assert.equal(off.body.twoFactorEnabled, false);
    const [row] = await db.select({ on: users.twoFactorEmail }).from(users).where(eq(users.id, user.id));
    assert.equal(row?.on, false);
  });

  it('cannot be turned on without an email or without email delivery', async () => {
    const noEmail = await makeAccount({ email: false });
    const a = await cookieFor(noEmail.id);
    const res = await call('POST', '/api/auth/two-factor/enable/request', { cookie: a.cookie, payload: { password: PASSWORD } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'email_required');

    config.RESEND_API_KEY = '';
    const user = await makeAccount();
    const b = await cookieFor(user.id);
    assert.equal((await call('GET', '/api/auth/security', { cookie: b.cookie })).body.emailDeliveryAvailable, false);
    const refused = await call('POST', '/api/auth/two-factor/enable/request', { cookie: b.cookie, payload: { password: PASSWORD } });
    assert.equal(refused.status, 503);
    assert.equal(refused.body.error.code, 'email_not_configured');
  });

  it('wrong passwords on the confirmation are limited per account', async () => {
    const user = await makeAccount();
    const { cookie } = await cookieFor(user.id);
    for (let i = 0; i < FAILURE_RULE.max; i++) await call('POST', '/api/auth/two-factor/disable', { cookie, payload: { password: 'nope' } });
    const blocked = await call('POST', '/api/auth/two-factor/disable', { cookie, payload: { password: PASSWORD } });
    assert.equal(blocked.status, 429);
  });
});

describe('changing the email', () => {
  it('needs the current password before any code is sent, and only then moves the address', async () => {
    const user = await makeAccount();
    const { cookie } = await cookieFor(user.id);
    const target = `moved_${user.id.slice(0, 8)}@example.test`;
    const request = (payload: Record<string, unknown>) => call('POST', '/api/auth/email/change/request', { cookie, payload });

    const missing = await request({ email: target });
    assert.equal(missing.status, 403);
    assert.equal(missing.body.error.code, 'invalid_password');
    const wrong = await request({ email: target, password: 'nope' });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error.code, 'invalid_password');
    assert.equal(mailbox.length, 0, 'no code goes to the new address without the password');

    assert.equal((await request({ email: target, password: PASSWORD })).status, 200);
    assert.deepEqual(mailbox.at(-1)?.to, [target]);
    const confirmed = await call('POST', '/api/auth/email/change/confirm', { cookie, payload: { email: target, code: lastCode() } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.user.email, target);
  });

  it('a wrong password does not reveal whether the address is taken', async () => {
    const user = await makeAccount();
    const other = await makeAccount();
    const { cookie } = await cookieFor(user.id);
    const res = await call('POST', '/api/auth/email/change/request', { cookie, payload: { email: other.email, password: 'nope' } });
    assert.equal(res.body.error.code, 'invalid_password');
  });
});

describe('linking an email to an account that has none', () => {
  it('the unverified link route is gone', async () => {
    const user = await makeAccount({ email: false });
    const { cookie } = await cookieFor(user.id);
    const res = await call('POST', '/api/auth/email/link', { cookie, payload: { email: `squat_${user.id.slice(0, 8)}@example.test` } });
    assert.equal(res.status, 404);
    const [row] = await db.select({ email: users.email }).from(users).where(eq(users.id, user.id));
    assert.equal(row?.email, null);
  });

  it('the address is set only after the code sent to it is confirmed', async () => {
    const user = await makeAccount({ email: false });
    const { cookie } = await cookieFor(user.id);
    const target = `linked_${user.id.slice(0, 8)}@example.test`;

    const request = await call('POST', '/api/auth/email/change/request', { cookie, payload: { email: target, password: PASSWORD } });
    assert.equal(request.status, 200);
    assert.deepEqual(mailbox.at(-1)?.to, [target]);
    const [pending] = await db.select({ email: users.email }).from(users).where(eq(users.id, user.id));
    assert.equal(pending?.email, null, 'requesting a code does not touch the account');

    const wrong = await call('POST', '/api/auth/email/change/confirm', { cookie, payload: { email: target, code: wrongCode(lastCode()) } });
    assert.equal(wrong.status, 400);
    const confirmed = await call('POST', '/api/auth/email/change/confirm', { cookie, payload: { email: target, code: lastCode() } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.user.email, target);
  });

  it('a code sent to one address cannot link another', async () => {
    const user = await makeAccount({ email: false });
    const { cookie } = await cookieFor(user.id);
    const sentTo = `mine_${user.id.slice(0, 8)}@example.test`;
    const other = `theirs_${user.id.slice(0, 8)}@example.test`;
    await call('POST', '/api/auth/email/change/request', { cookie, payload: { email: sentTo, password: PASSWORD } });
    const res = await call('POST', '/api/auth/email/change/confirm', { cookie, payload: { email: other, code: lastCode() } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_code');
  });

  it('refuses an address that already belongs to another account before any code is sent', async () => {
    const owner = await makeAccount();
    const user = await makeAccount({ email: false });
    const { cookie } = await cookieFor(user.id);
    const res = await call('POST', '/api/auth/email/change/request', { cookie, payload: { email: owner.email, password: PASSWORD } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'email_taken');
    assert.equal(mailbox.length, 0);
  });
});

describe('the session list', () => {
  it('lists the account sessions with their origin, marking this one', async () => {
    const user = await makeAccount();
    const here = await cookieFor(user.id, { ip: '203.0.113.7', userAgent: 'Here/1.0' });
    await cookieFor(user.id, { ip: '198.51.100.2', userAgent: 'There/2.0' });
    const other = await makeAccount();
    await cookieFor(other.id);

    const res = await call('GET', '/api/auth/sessions', { cookie: here.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.sessions.length, 2);
    const current = res.body.sessions.find((s: { current: boolean }) => s.current);
    assert.equal(current.ip, '203.0.113.7');
    assert.equal(current.userAgent, 'Here/1.0');
    assert.ok(res.body.sessions.some((s: { userAgent: string; current: boolean }) => s.userAgent === 'There/2.0' && !s.current));
    assert.ok(res.body.sessions.every((s: Record<string, unknown>) => !('tokenHash' in s)));
  });

  it('ending another session signs it out at once, socket included', async () => {
    const user = await makeAccount();
    const here = await cookieFor(user.id);
    const there = await cookieFor(user.id);
    assert.equal((await me(there.cookie)).status, 200); // cached now: the revocation must clear that too
    const tab = connectedTab(user, there.tokenHash);
    const bystander = connectedTab(user, here.tokenHash);

    const list = (await call('GET', '/api/auth/sessions', { cookie: here.cookie })).body.sessions as { id: string; current: boolean }[];
    const target = list.find((s) => !s.current)!;
    const res = await call('DELETE', `/api/auth/sessions/${target.id}`, { cookie: here.cookie });
    assert.equal(res.status, 204);

    assert.equal((await me(there.cookie)).status, 401);
    assert.equal((await me(here.cookie)).status, 200);
    assert.ok(tab.sent.some((m) => m.event === 'session-ended'));
    assert.equal(tab.disconnected, true);
    assert.equal(participants.has(tab.participant.id), false);
    assert.equal(participants.has(bystander.participant.id), true);
    assert.equal(bystander.disconnected, false);
  });

  it('refuses this session, an unknown one and someone else\'s', async () => {
    const user = await makeAccount();
    const here = await cookieFor(user.id);
    const list = (await call('GET', '/api/auth/sessions', { cookie: here.cookie })).body.sessions as { id: string }[];
    assert.equal((await call('DELETE', `/api/auth/sessions/${list[0]!.id}`, { cookie: here.cookie })).status, 400);
    assert.equal((await call('DELETE', `/api/auth/sessions/${uid()}`, { cookie: here.cookie })).status, 404);

    const other = await makeAccount();
    const theirs = await cookieFor(other.id);
    const [theirRow] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.tokenHash, theirs.tokenHash));
    assert.equal((await call('DELETE', `/api/auth/sessions/${theirRow!.id}`, { cookie: here.cookie })).status, 404);
    assert.equal((await me(theirs.cookie)).status, 200);
  });

  it('ending all the others keeps only this one', async () => {
    const user = await makeAccount();
    const here = await cookieFor(user.id);
    const a = await cookieFor(user.id);
    const b = await cookieFor(user.id);
    const tab = connectedTab(user, a.tokenHash);

    const res = await call('POST', '/api/auth/sessions/end-others', { cookie: here.cookie });
    assert.equal(res.status, 200);
    assert.equal(res.body.endedSessions, 2);
    assert.equal((await me(a.cookie)).status, 401);
    assert.equal((await me(b.cookie)).status, 401);
    assert.equal((await me(here.cookie)).status, 200);
    assert.equal(tab.disconnected, true);
    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, user.id), eq(adminAuditLogs.action, 'account.sessions_end_others')));
    assert.equal(trail.length, 1);
  });
});

describe('idle expiry', () => {
  it('a session unused past the limit is refused and deleted, though its TTL has not run out', async () => {
    config.SESSION_IDLE_DAYS = 14;
    const user = await makeAccount();
    const idle = await cookieFor(user.id);
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 15 * DAY_MS) }).where(eq(sessions.tokenHash, idle.tokenHash));
    assert.equal(await resolveSession(idle.rawToken), null);
    assert.equal((await db.select().from(sessions).where(eq(sessions.tokenHash, idle.tokenHash))).length, 0);
  });

  it('a session used within the limit stays, and 0 turns the limit off', async () => {
    config.SESSION_IDLE_DAYS = 14;
    const user = await makeAccount();
    const recent = await cookieFor(user.id);
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 13 * DAY_MS) }).where(eq(sessions.tokenHash, recent.tokenHash));
    assert.ok(await resolveSession(recent.rawToken));

    config.SESSION_IDLE_DAYS = 0;
    const old = await cookieFor(user.id);
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 100 * DAY_MS) }).where(eq(sessions.tokenHash, old.tokenHash));
    assert.ok(await resolveSession(old.rawToken));
  });

  it('the sweep removes idle sessions but not the ones a live socket just touched', async () => {
    config.SESSION_IDLE_DAYS = 14;
    const user = await makeAccount();
    const idle = await cookieFor(user.id);
    const live = await cookieFor(user.id);
    for (const s of [idle, live]) {
      await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 15 * DAY_MS) }).where(eq(sessions.tokenHash, s.tokenHash));
    }
    await touchSessions([live.tokenHash]);
    await sweepExpiredSessions();
    const left = await db.select({ tokenHash: sessions.tokenHash }).from(sessions).where(eq(sessions.userId, user.id));
    assert.deepEqual(left.map((r) => r.tokenHash), [live.tokenHash]);
  });

  it('use refreshes the last-seen time, at most once a minute', async () => {
    const user = await makeAccount();
    const lastSeenOf = async (hash: string) => (await db.select({ at: sessions.lastSeenAt }).from(sessions).where(eq(sessions.tokenHash, hash)))[0]!.at.getTime();

    const fresh = await cookieFor(user.id);
    const thirtySecondsAgo = new Date(Date.now() - 30_000);
    await db.update(sessions).set({ lastSeenAt: thirtySecondsAgo }).where(eq(sessions.tokenHash, fresh.tokenHash));
    await resolveSession(fresh.rawToken);
    assert.equal(await lastSeenOf(fresh.tokenHash), thirtySecondsAgo.getTime());

    const stale = await cookieFor(user.id);
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 5 * 60_000) }).where(eq(sessions.tokenHash, stale.tokenHash));
    await resolveSession(stale.rawToken);
    // the write is fire-and-forget; give it a moment to land
    for (let i = 0; i < 50 && (await lastSeenOf(stale.tokenHash)) < Date.now() - 60_000; i++) await new Promise((r) => setTimeout(r, 20));
    assert.ok((await lastSeenOf(stale.tokenHash)) > Date.now() - 60_000);
  });
});

describe('guessing password reset codes', () => {
  const reset = (identifier: Record<string, unknown>, code: string, ip = freshIp()) =>
    call('POST', '/api/auth/recovery/reset', { ip, payload: { ...identifier, code, password: 'another new password' } });

  it('requesting a new code does not restore the guess budget', async () => {
    const user = await makeAccount();
    const ask = () => call('POST', '/api/auth/recovery/request', { payload: { username: user.username } });
    await ask();
    let right = lastCode();
    // every guess comes from a different address, so only the per-account counter can stop them
    for (let i = 0; i < FAILURE_RULE.max; i++) {
      if (i > 0 && i % config.AUTH_CODE_MAX_ATTEMPTS === 0) { await ask(); right = lastCode(); }
      assert.equal((await reset({ username: user.username }, wrongCode(right))).status, 400);
    }
    const blocked = await reset({ username: user.username }, right);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers['retry-after']) > 0);
    // naming the account by email lands on the same counter
    assert.equal((await reset({ email: user.email }, right)).status, 429);
    assert.equal((await login(user.username)).status, 200);
  });

  it('blocks an address across accounts', async () => {
    const ip = freshIp();
    for (let i = 0; i < FAILURE_RULE.max; i++) await reset({ username: `ghost_${uid().slice(0, 10)}` }, '123456', ip);
    assert.equal((await reset({ username: `ghost_${uid().slice(0, 10)}` }, '123456', ip)).status, 429);
  });

  it('answers a missing account like an existing one', async () => {
    const username = `ghost_${uid().slice(0, 10)}`;
    for (let i = 0; i < FAILURE_RULE.max; i++) assert.equal((await reset({ username }, '123456')).status, 400);
    assert.equal((await reset({ username }, '123456')).status, 429);
  });

  it('a correct reset clears the account counter', async () => {
    const user = await makeAccount();
    await call('POST', '/api/auth/recovery/request', { payload: { username: user.username } });
    const right = lastCode();
    for (let i = 0; i < 3; i++) await reset({ username: user.username }, wrongCode(right));
    assert.equal((await reset({ username: user.username }, right)).status, 200);
    const key = crypto.createHash('sha256').update(`reset-code:${user.id}`).digest('hex');
    assert.equal((await db.select().from(rateLimitWindows).where(eq(rateLimitWindows.key, key))).length, 0);
  });

  it('asking by username and by email shares one send budget per account', async () => {
    const user = await makeAccount();
    for (let i = 0; i < 8; i++) {
      const res = await call('POST', '/api/auth/recovery/request', { payload: i % 2 ? { username: user.username } : { email: user.email } });
      assert.equal(res.status, 200);
    }
    // the answer never changes, but past the account's ceiling nothing goes out
    assert.equal(mailbox.length, 5);
  });
});

describe('changing the password', () => {
  it('signs out the other devices and keeps this one', async () => {
    const user = await makeAccount();
    const here = await cookieFor(user.id);
    const there = await cookieFor(user.id);
    const tab = connectedTab(user, there.tokenHash);

    const wrong = await call('POST', '/api/auth/password', { cookie: here.cookie, payload: { currentPassword: 'nope', newPassword: 'a brand new password' } });
    assert.equal(wrong.status, 403);
    assert.equal((await me(there.cookie)).status, 200);

    const weak = await call('POST', '/api/auth/password', { cookie: here.cookie, payload: { currentPassword: PASSWORD, newPassword: 'short' } });
    assert.equal(weak.body.error.code, 'weak_password');

    const res = await call('POST', '/api/auth/password', { cookie: here.cookie, payload: { currentPassword: PASSWORD, newPassword: 'a brand new password' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.endedSessions, 1);
    assert.equal((await me(here.cookie)).status, 200);
    assert.equal((await me(there.cookie)).status, 401);
    assert.equal(tab.disconnected, true);

    assert.equal((await login(user.username)).status, 401);
    assert.equal((await login(user.username, 'a brand new password')).status, 200);
  });

  it('a recovery reset signs out every device', async () => {
    const user = await makeAccount();
    const a = await cookieFor(user.id);
    const tab = connectedTab(user, a.tokenHash);
    await call('POST', '/api/auth/recovery/request', { payload: { username: user.username } });
    const res = await call('POST', '/api/auth/recovery/reset', { payload: { username: user.username, code: lastCode(), password: 'another new password' } });
    assert.equal(res.status, 200);
    assert.equal((await me(a.cookie)).status, 401);
    assert.equal(tab.disconnected, true);
  });
});

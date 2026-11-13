import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { adminAuditLogs, authCodes, knownLogins, rateLimitWindows, sessions, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createSession, resolveSession, sweepExpiredSessions, touchSessions } from '../../src/modules/auth/session.js';
import { FAILURE_RULE } from '../../src/modules/auth/ratelimit.js';
import { KNOWN_LOGIN_DAYS, recordLogin, sweepKnownLogins, whenLoginAlertsSettled } from '../../src/modules/auth/loginAlert.js';
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
const saved = { key: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL, idle: config.SESSION_IDLE_DAYS, appUrl: config.APP_URL };

beforeEach(() => {
  mailbox = [];
  config.RESEND_API_KEY = 're_test';
  config.RESEND_FROM_EMAIL = 'Linkord <noreply@example.test>';
  config.APP_URL = 'https://chat.example.test';
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    mailbox.push(JSON.parse(String(init.body)));
    return new Response('{}', { status: 200 });
  });
});
afterEach(async () => {
  // an alert from this test's logins must land in this test's mailbox, not the next one's
  await whenLoginAlertsSettled();
  mock.restoreAll();
  config.RESEND_API_KEY = saved.key;
  config.RESEND_FROM_EMAIL = saved.from;
  config.SESSION_IDLE_DAYS = saved.idle;
  config.APP_URL = saved.appUrl;
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

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { payload?: Record<string, unknown>; cookie?: string; ip?: string; ua?: string } = {}): Promise<Reply> {
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
    const asked = await call('POST', '/api/auth/two-factor/disable', { cookie, payload: { password: PASSWORD } });
    assert.equal(asked.status, 200);
    assert.equal(asked.body.codeRequired, true);
    const off = await call('POST', '/api/auth/two-factor/disable/confirm', { cookie, payload: { code: lastCode() } });
    assert.equal(off.body.twoFactorEnabled, false);
    const [row] = await db.select({ on: users.twoFactorEmail }).from(users).where(eq(users.id, user.id));
    assert.equal(row?.on, false);
  });

  it('turning it off takes a code sent to the current email, not just the password', async () => {
    const user = await makeAccount({ twoFactor: true });
    const { cookie } = await cookieFor(user.id);
    const isOn = async () => (await db.select({ on: users.twoFactorEmail }).from(users).where(eq(users.id, user.id)))[0]?.on;

    const asked = await call('POST', '/api/auth/two-factor/disable', { cookie, payload: { password: PASSWORD } });
    assert.equal(asked.status, 200);
    assert.deepEqual(asked.body, { codeRequired: true, email: asked.body.email });
    assert.notEqual(asked.body.email, user.email, 'the address is masked');
    assert.deepEqual(mailbox.at(-1)?.to, [user.email]);
    assert.equal(await isOn(), true, 'the password alone leaves it on');

    // without the code, deleting the account still asks for one
    const deletion = await call('POST', '/api/auth/account/deletion/request', { cookie, payload: { password: PASSWORD } });
    assert.equal(deletion.body.codeRequired, true);
    assert.equal(deletion.body.deletionDueAt, undefined);

    // the deletion code above was the last email, so ask for the turn-off code again
    assert.equal((await call('POST', '/api/auth/two-factor/disable', { cookie, payload: { password: PASSWORD } })).status, 200);
    const code = lastCode();
    const wrong = await call('POST', '/api/auth/two-factor/disable/confirm', { cookie, payload: { code: wrongCode(code) } });
    assert.equal(wrong.status, 400);
    assert.equal(await isOn(), true);
    const off = await call('POST', '/api/auth/two-factor/disable/confirm', { cookie, payload: { code } });
    assert.equal(off.status, 200);
    assert.equal(off.body.twoFactorEnabled, false);
    assert.equal(await isOn(), false);
  });

  it('a code sent for another change cannot turn it off', async () => {
    const user = await makeAccount({ twoFactor: true });
    const { cookie } = await cookieFor(user.id);
    await call('PUT', '/api/auth/login-alerts', { cookie, payload: { enabled: false, password: PASSWORD } });
    const res = await call('POST', '/api/auth/two-factor/disable/confirm', { cookie, payload: { code: lastCode() } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'invalid_code');
  });

  it('turning it off when it is already off asks no code', async () => {
    const user = await makeAccount();
    const { cookie } = await cookieFor(user.id);
    const res = await call('POST', '/api/auth/two-factor/disable', { cookie, payload: { password: PASSWORD } });
    assert.deepEqual(res.body, { twoFactorEnabled: false });
    assert.equal(mailbox.length, 0);
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

  it('tells the old address, signs every other session out and leaves a trail', async () => {
    const user = await makeAccount();
    const mine = await cookieFor(user.id);
    const other = await cookieFor(user.id);
    const tab = connectedTab(user, other.tokenHash);
    const target = `moved_${user.id.slice(0, 8)}@example.test`;

    await call('POST', '/api/auth/email/change/request', { cookie: mine.cookie, payload: { email: target, password: PASSWORD } });
    const confirmed = await call('POST', '/api/auth/email/change/confirm', { cookie: mine.cookie, payload: { email: target, code: lastCode() } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.endedSessions, 1);

    const notice = mailbox.at(-1);
    assert.deepEqual(notice?.to, [user.email]);
    assert.ok(!notice?.text.includes(target), 'the new address is masked in the notice');
    assert.equal((await me(other.cookie)).status, 401);
    assert.equal(tab.disconnected, true);
    assert.equal((await me(mine.cookie)).status, 200, 'the session that made the change stays');
    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, user.id), eq(adminAuditLogs.action, 'account.email_change')));
    assert.equal(trail.length, 1);
  });

  it('with two-step login on, the current address confirms before the new one gets a code', async () => {
    const user = await makeAccount({ twoFactor: true });
    const { cookie } = await cookieFor(user.id);
    const target = `moved_${user.id.slice(0, 8)}@example.test`;
    const request = () => call('POST', '/api/auth/email/change/request', { cookie, payload: { email: target, password: PASSWORD } });

    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(first.body.codeRequired, true);
    assert.deepEqual(mailbox.at(-1)?.to, [user.email], 'the code goes to the current address');
    assert.equal(mailbox.filter((m) => m.to.includes(target)).length, 0, 'nothing reaches the new address yet');
    const currentCode = lastCode();

    // the new address cannot be confirmed with the current address's code, nor by skipping that step
    const skipped = await call('POST', '/api/auth/email/change/confirm', { cookie, payload: { email: target, code: currentCode } });
    assert.equal(skipped.status, 400);
    const wrong = await call('POST', '/api/auth/email/change/verify-current', { cookie, payload: { email: target, code: wrongCode(currentCode) } });
    assert.equal(wrong.status, 400);

    const verified = await call('POST', '/api/auth/email/change/verify-current', { cookie, payload: { email: target, code: currentCode } });
    assert.equal(verified.status, 200);
    assert.deepEqual(mailbox.at(-1)?.to, [target]);

    // asking again now resends to the new address instead of starting over
    const resent = await request();
    assert.deepEqual(resent.body, { ok: true });
    assert.deepEqual(mailbox.at(-1)?.to, [target]);

    const confirmed = await call('POST', '/api/auth/email/change/confirm', { cookie, payload: { email: target, code: lastCode() } });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.user.email, target);
    assert.deepEqual(mailbox.at(-1)?.to, [user.email], 'the old address hears about it');
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

  it('logging out cuts the sockets opened with that session, and only those', async () => {
    const user = await makeAccount();
    const here = await cookieFor(user.id);
    const other = await cookieFor(user.id);
    const tab = connectedTab(user, here.tokenHash);
    const bystander = connectedTab(user, other.tokenHash);

    const res = await call('POST', '/api/auth/logout', { cookie: here.cookie });
    assert.equal(res.status, 204);

    assert.equal((await me(here.cookie)).status, 401);
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

describe('an account whose counters someone else filled', () => {
  const OWNER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const keyHash = (key: string) => crypto.createHash('sha256').update(key).digest('hex');
  const countOf = async (key: string) =>
    (await db.select().from(rateLimitWindows).where(eq(rateLimitWindows.key, keyHash(key))))[0]?.count ?? 0;

  /** An account its owner signed in to from `home` before someone else started on it. */
  async function ownedAccount() {
    const user = await makeAccount();
    const home = { ip: freshIp(), userAgent: OWNER_UA };
    await recordLogin(user.id, home);
    return { user, home };
  }

  async function lockLogin(username: string) {
    const attacker = freshIp();
    for (let i = 0; i < FAILURE_RULE.max; i++) assert.equal((await login(username, 'wrong password', attacker)).status, 401);
  }

  it('lets the right password in from a browser the account signed in from lately', async () => {
    const { user, home } = await ownedAccount();
    await lockLogin(user.username);

    const owner = await call('POST', '/api/auth/login', { payload: { username: user.username, password: PASSWORD }, ip: home.ip, ua: home.userAgent });
    assert.equal(owner.status, 200);
    assert.ok(owner.cookie);
    // the owner getting through does not hand whoever filled it a fresh round
    assert.equal((await login(user.username, PASSWORD)).status, 429);
  });

  it('still refuses the known browser a wrong password, and a stranger the right one', async () => {
    const { user, home } = await ownedAccount();
    await lockLogin(user.username);

    const wrong = await call('POST', '/api/auth/login', { payload: { username: user.username, password: 'wrong password' }, ip: home.ip, ua: home.userAgent });
    assert.equal(wrong.status, 429);
    // same address, another kind of browser
    const otherBrowser = await call('POST', '/api/auth/login', { payload: { username: user.username, password: PASSWORD }, ip: home.ip, ua: 'curl/8.0' });
    assert.equal(otherBrowser.status, 429);
    const elsewhere = await login(user.username, PASSWORD);
    assert.equal(elsewhere.status, 429);
    assert.ok(Number(elsewhere.headers['retry-after']) > 0);
  });

  it('answers and counts a stranger the same whether the password was right or not', async () => {
    const { user } = await ownedAccount();
    await lockLogin(user.username);
    const ip = freshIp();

    const right = await login(user.username, PASSWORD, ip);
    const wrong = await login(user.username, 'wrong password', ip);
    assert.deepEqual([right.status, right.body], [wrong.status, wrong.body]);
    assert.equal(await countOf(`ip:${ip}`), 2);
  });

  it('a browser not seen for a month is a stranger again', async () => {
    const { user, home } = await ownedAccount();
    await db.update(knownLogins).set({ lastLoginAt: new Date(Date.now() - (KNOWN_LOGIN_DAYS + 1) * DAY_MS) }).where(eq(knownLogins.userId, user.id));
    await lockLogin(user.username);
    const res = await call('POST', '/api/auth/login', { payload: { username: user.username, password: PASSWORD }, ip: home.ip, ua: home.userAgent });
    assert.equal(res.status, 429);
  });

  it('recovery requests naming the account never refuse anyone', async () => {
    const user = await makeAccount();
    for (let i = 0; i < FAILURE_RULE.max + 2; i++) {
      assert.equal((await call('POST', '/api/auth/recovery/request', { payload: { username: user.username } })).status, 200);
    }
    // only the codes that go out are counted against the account
    assert.equal(mailbox.length, 5);
    assert.equal(await countOf(`recovery-username:${user.username.toLowerCase()}`), 0);
  });

  it('strangers spending the recovery codes leave the owner a budget of their own', async () => {
    const { user, home } = await ownedAccount();
    for (let i = 0; i < 6; i++) await call('POST', '/api/auth/recovery/request', { payload: { username: user.username } });
    assert.equal(mailbox.length, 5);

    await call('POST', '/api/auth/recovery/request', { payload: { email: user.email }, ip: home.ip, ua: home.userAgent });
    assert.equal(mailbox.length, 6);
    const res = await call('POST', '/api/auth/recovery/reset', {
      payload: { username: user.username, code: lastCode(), password: 'another new password' }, ip: home.ip, ua: home.userAgent,
    });
    assert.equal(res.status, 200);
  });

  it('a filled reset-code counter still takes the owner\'s code from a known browser', async () => {
    const { user, home } = await ownedAccount();
    await call('POST', '/api/auth/recovery/request', { payload: { username: user.username }, ip: home.ip, ua: home.userAgent });
    const right = lastCode();
    // a stranger burns guesses from many addresses until the account's counter blocks; the dead codes are replaced
    for (let i = 0; i < FAILURE_RULE.max; i++) {
      await call('POST', '/api/auth/recovery/reset', { payload: { username: user.username, code: wrongCode(right), password: 'whatever whatever' } });
    }
    const stranger = await call('POST', '/api/auth/recovery/reset', { payload: { username: user.username, code: right, password: 'whatever whatever' } });
    assert.equal(stranger.status, 429);

    await call('POST', '/api/auth/recovery/request', { payload: { username: user.username }, ip: home.ip, ua: home.userAgent });
    const owner = await call('POST', '/api/auth/recovery/reset', {
      payload: { username: user.username, code: lastCode(), password: 'another new password' }, ip: home.ip, ua: home.userAgent,
    });
    assert.equal(owner.status, 200);
    // the owner getting through does not reopen the guessing for everyone else
    assert.equal((await call('POST', '/api/auth/recovery/reset', { payload: { username: user.username, code: '123456', password: 'whatever whatever' } })).status, 429);
    assert.equal((await login(user.username, 'another new password')).status, 200);
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

describe('new sign-in alerts', () => {
  const CHROME_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';
  const alertsTo = (email: string | null) => mailbox.filter((m) => m.to.includes(email!) && /sign-in|login|entrou/i.test(`${m.subject}`) && !/\b\d{6}\b/.test(m.text));

  /** Signs in and waits for the alert, which is sent in the background. */
  const signIn = async (username: string, ip: string, ua: string, password = PASSWORD) => {
    const res = await call('POST', '/api/auth/login', { payload: { username, password }, ip, ua });
    await whenLoginAlertsSettled();
    return res;
  };

  it('emails the account about a browser it has not used lately, with where to end the session', async () => {
    const user = await makeAccount();
    await db.update(users).set({ locale: 'en-US' }).where(eq(users.id, user.id));
    const ip = freshIp();
    const res = await signIn(user.username, ip, CHROME_MAC);
    assert.equal(res.status, 200);

    const [mail] = alertsTo(user.email);
    assert.ok(mail, 'an alert should have been sent');
    assert.equal(mail.subject, 'New sign-in to your Linkord account');
    assert.match(mail.text, /Browser: Chrome on macOS/);
    assert.ok(mail.text.includes(`IP address: ${ip}`));
    assert.match(mail.text, /Time: .* UTC/);
    assert.ok(mail.text.includes(`${config.APP_URL}/app/settings/security#sessions`));
  });

  it('is written in the account language', async () => {
    const user = await makeAccount();
    await signIn(user.username, freshIp(), FIREFOX_LINUX);
    const [mail] = alertsTo(user.email);
    assert.equal(mail?.subject, 'Novo login na sua conta Linkord');
    assert.match(mail!.text, /Navegador: Firefox em Linux/);
  });

  it('stays quiet when the same browser signs in again, even after logging out', async () => {
    const user = await makeAccount();
    const ip = freshIp();
    const first = await signIn(user.username, ip, CHROME_MAC);
    assert.equal(alertsTo(user.email).length, 1);
    await call('POST', '/api/auth/logout', { cookie: first.cookie! });
    await signIn(user.username, ip, CHROME_MAC);
    await signIn(user.username, ip, CHROME_MAC);
    assert.equal(alertsTo(user.email).length, 1, 'the same address and browser is not new');
  });

  it('alerts again for another address or another browser', async () => {
    const user = await makeAccount();
    const ip = freshIp();
    await signIn(user.username, ip, CHROME_MAC);
    await signIn(user.username, freshIp(), CHROME_MAC);
    await signIn(user.username, ip, FIREFOX_LINUX);
    assert.equal(alertsTo(user.email).length, 3);
  });

  it('stays quiet after the browser updates itself', async () => {
    const user = await makeAccount();
    const ip = freshIp();
    await signIn(user.username, ip, CHROME_MAC);
    await signIn(user.username, ip, CHROME_MAC.replace('Chrome/130.0.0.0', 'Chrome/131.0.0.0'));
    assert.equal(alertsTo(user.email).length, 1);
  });

  it('sends one alert when the same new browser signs in twice at once', async () => {
    const user = await makeAccount();
    const ip = freshIp();
    await Promise.all([
      call('POST', '/api/auth/login', { payload: { username: user.username, password: PASSWORD }, ip, ua: CHROME_MAC }),
      call('POST', '/api/auth/login', { payload: { username: user.username, password: PASSWORD }, ip, ua: CHROME_MAC }),
    ]);
    await whenLoginAlertsSettled();
    assert.equal(alertsTo(user.email).length, 1);
  });

  it('keeps knowing the browsers the upgrade backfill recorded', async () => {
    const user = await makeAccount();
    const ip = freshIp();
    // what migration 0063 wrote for a browser holding a session: sha256 of the address and the whole user agent
    const legacy = crypto.createHash('sha256').update(`${ip}\n${CHROME_MAC}`).digest('hex');
    await db.insert(knownLogins).values({ userId: user.id, fingerprint: legacy, lastLoginAt: new Date() });
    await signIn(user.username, ip, CHROME_MAC);
    assert.equal(alertsTo(user.email).length, 0);
  });

  it('treats a browser not seen for a month as new again', async () => {
    const user = await makeAccount();
    const ip = freshIp();
    await signIn(user.username, ip, CHROME_MAC);
    assert.equal(alertsTo(user.email).length, 1);
    await db.update(knownLogins).set({ lastLoginAt: new Date(Date.now() - (KNOWN_LOGIN_DAYS + 1) * DAY_MS) }).where(eq(knownLogins.userId, user.id));
    await signIn(user.username, ip, CHROME_MAC);
    assert.equal(alertsTo(user.email).length, 2);
  });

  it('with two-step login, alerts once the code finishes the login and not at the password step', async () => {
    const user = await makeAccount({ twoFactor: true });
    const ip = freshIp();
    const first = await call('POST', '/api/auth/login', { payload: { username: user.username, password: PASSWORD }, ip, ua: CHROME_MAC });
    await whenLoginAlertsSettled();
    assert.equal(alertsTo(user.email).length, 0, 'no session yet, nothing to warn about');

    const done = await call('POST', '/api/auth/login/verify', { payload: { challenge: first.body.twoFactor.challenge, code: lastCode() }, ip, ua: CHROME_MAC });
    assert.equal(done.status, 200);
    await whenLoginAlertsSettled();
    assert.equal(alertsTo(user.email).length, 1);
  });

  it('does not alert for the browser that registered the account', async () => {
    const user = await makeAccount();
    const origin = { ip: freshIp(), userAgent: CHROME_MAC };
    assert.equal(await recordLogin(user.id, origin), true);
    await signIn(user.username, origin.ip, origin.userAgent);
    assert.equal(alertsTo(user.email).length, 0);
  });

  it('is skipped when the account turned it off, has no email or the server cannot send', async () => {
    const off = await makeAccount();
    await db.update(users).set({ loginAlertEmail: false }).where(eq(users.id, off.id));
    assert.equal((await signIn(off.username, freshIp(), CHROME_MAC)).status, 200);

    const noEmail = await makeAccount({ email: false });
    assert.equal((await signIn(noEmail.username, freshIp(), CHROME_MAC)).status, 200);

    const unconfigured = await makeAccount();
    config.RESEND_API_KEY = '';
    assert.equal((await signIn(unconfigured.username, freshIp(), CHROME_MAC)).status, 200);

    assert.equal(mailbox.length, 0);
  });

  it('a failing email never fails the login', async () => {
    mock.restoreAll();
    mock.method(globalThis, 'fetch', async () => new Response('down', { status: 503 }));
    const user = await makeAccount();
    const res = await signIn(user.username, freshIp(), CHROME_MAC);
    assert.equal(res.status, 200);
    assert.equal((await me(res.cookie!)).status, 200);
  });

  it('caps the alerts one account can receive in an hour', async () => {
    const user = await makeAccount();
    for (let i = 0; i < 7; i++) await signIn(user.username, freshIp(), CHROME_MAC);
    assert.equal(alertsTo(user.email).length, 5);
  });

  it('forgets browsers past the window when the sweep runs', async () => {
    const user = await makeAccount();
    await recordLogin(user.id, { ip: '198.51.100.1', userAgent: 'old' }, new Date(Date.now() - (KNOWN_LOGIN_DAYS + 1) * DAY_MS));
    await recordLogin(user.id, { ip: '198.51.100.2', userAgent: 'recent' });
    await sweepKnownLogins();
    assert.equal((await db.select().from(knownLogins).where(eq(knownLogins.userId, user.id))).length, 1);
  });
});

describe('the sign-in alert switch', () => {
  it('is on by default, reported with the security status and changed by its owner only', async () => {
    const user = await makeAccount();
    const { cookie } = await cookieFor(user.id);
    assert.equal((await call('GET', '/api/auth/security', { cookie })).body.loginAlertEnabled, true);

    assert.equal((await call('PUT', '/api/auth/login-alerts', { payload: { enabled: false } })).status, 401);
    assert.equal((await call('PUT', '/api/auth/login-alerts', { payload: { enabled: 'no' }, cookie })).status, 400);

    const off = await call('PUT', '/api/auth/login-alerts', { payload: { enabled: false, password: PASSWORD }, cookie });
    assert.equal(off.status, 200);
    assert.equal(off.body.loginAlertEnabled, false);
    assert.equal((await call('GET', '/api/auth/security', { cookie })).body.loginAlertEnabled, false);

    await call('PUT', '/api/auth/login-alerts', { payload: { enabled: true }, cookie });
    assert.equal((await call('GET', '/api/auth/security', { cookie })).body.loginAlertEnabled, true);
  });

  it('turning it off asks for the password', async () => {
    const user = await makeAccount();
    const { cookie } = await cookieFor(user.id);
    for (const payload of [{ enabled: false }, { enabled: false, password: 'nope' }]) {
      const res = await call('PUT', '/api/auth/login-alerts', { payload, cookie });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, 'invalid_password');
    }
    assert.equal((await call('GET', '/api/auth/security', { cookie })).body.loginAlertEnabled, true);
  });

  it('with two-step login on, turning it off also takes a code sent to the current email', async () => {
    const user = await makeAccount({ twoFactor: true });
    const { cookie } = await cookieFor(user.id);
    const asked = await call('PUT', '/api/auth/login-alerts', { payload: { enabled: false, password: PASSWORD }, cookie });
    assert.equal(asked.status, 200);
    assert.equal(asked.body.codeRequired, true);
    assert.deepEqual(mailbox.at(-1)?.to, [user.email]);
    assert.equal((await call('GET', '/api/auth/security', { cookie })).body.loginAlertEnabled, true);

    const code = lastCode();
    assert.equal((await call('POST', '/api/auth/login-alerts/disable/confirm', { payload: { code: wrongCode(code) }, cookie })).status, 400);
    const off = await call('POST', '/api/auth/login-alerts/disable/confirm', { payload: { code }, cookie });
    assert.equal(off.status, 200);
    assert.equal(off.body.loginAlertEnabled, false);
    assert.equal((await call('GET', '/api/auth/security', { cookie })).body.loginAlertEnabled, false);
    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, user.id), eq(adminAuditLogs.action, 'account.login_alert_disable')));
    assert.equal(trail.length, 1);
  });
});

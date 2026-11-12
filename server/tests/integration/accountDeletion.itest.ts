import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { adminAuditLogs, servers, sessions, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createSession } from '../../src/modules/auth/session.js';
import { sweepDueAccountDeletions } from '../../src/modules/auth/accountDeletion.js';
import { whenLoginAlertsSettled } from '../../src/modules/auth/loginAlert.js';
import { db, makeServerWithMembers, makeUser, memberCount, ownerOf, pool } from './helpers.js';

// Deleting your own account against the real database: asking for it (password, and the emailed code with
// two-step login on), the grace period a sign-in cancels, and the sweep that then runs the admin deletion.

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

const PASSWORD = 'correct horse battery';
const DAY_MS = 24 * 60 * 60 * 1000;
const freshIp = () => `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(1, 255)}`;

let mailbox: { to: string[]; subject: string; text: string }[] = [];
const saved = { key: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL, appUrl: config.APP_URL };

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
  await whenLoginAlertsSettled();
  mock.restoreAll();
  Object.assign(config, { RESEND_API_KEY: saved.key, RESEND_FROM_EMAIL: saved.from, APP_URL: saved.appUrl });
});

async function makeAccount(opts: { twoFactor?: boolean; role?: 'user' | 'admin' } = {}) {
  const id = crypto.randomUUID();
  const username = `del_${id.slice(0, 8)}`;
  const email = `${username}@example.test`;
  await db.insert(users).values({
    id, username, email, passwordHash: await hashPassword(PASSWORD), twoFactorEmail: opts.twoFactor ?? false, role: opts.role ?? 'user',
    loginAlertEmail: false,
  });
  const { rawToken } = await createSession(id);
  return { id, username, email, cookie: `${config.SESSION_COOKIE}=${rawToken}` };
}

interface Reply { status: number; body: any; setCookie: string }

async function call(url: string, payload: Record<string, unknown>, cookie?: string): Promise<Reply> {
  const ip = freshIp();
  const res = await app.inject({ method: 'POST', url, payload, remoteAddress: ip, headers: { ...(cookie ? { cookie } : {}), 'x-forwarded-for': ip } });
  const raw = res.headers['set-cookie'];
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, setCookie: String(Array.isArray(raw) ? raw[0] : raw ?? '') };
}

const requestDeletion = (cookie: string, password = PASSWORD) => call('/api/auth/account/deletion/request', { password }, cookie);
const confirmDeletion = (cookie: string, code: string) => call('/api/auth/account/deletion/confirm', { code }, cookie);
const login = (username: string) => call('/api/auth/login', { username, password: PASSWORD });

async function accountRow(id: string) {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

async function auditActions(targetId: string): Promise<string[]> {
  const rows = await db.select({ action: adminAuditLogs.action }).from(adminAuditLogs).where(eq(adminAuditLogs.targetId, targetId));
  return rows.map((r) => r.action);
}

function lastCode(): string {
  const match = mailbox.at(-1)?.text.match(/\b(\d{6})\b/);
  assert.ok(match, 'the email should carry a 6-digit code');
  return match[1]!;
}

/** Moves a scheduled deletion into the past, as if the grace period had run out. */
async function expireGrace(userId: string): Promise<void> {
  await db.update(users).set({ deletionDueAt: new Date(Date.now() - 60_000) }).where(eq(users.id, userId));
}

describe('asking to delete your own account', () => {
  it('needs a session and the current password', async () => {
    const user = await makeAccount();
    assert.equal((await call('/api/auth/account/deletion/request', { password: PASSWORD })).status, 401);
    const wrong = await requestDeletion(user.cookie, 'not the password');
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body.error.code, 'invalid_password');
    assert.equal((await accountRow(user.id))?.deletionDueAt, null);
  });

  it('schedules the deletion after the grace period, signs out everywhere and emails the date', async () => {
    const user = await makeAccount();
    await createSession(user.id); // another device
    const before = Date.now();
    const res = await requestDeletion(user.cookie);
    assert.equal(res.status, 200);
    const due = new Date(res.body.deletionDueAt).getTime();
    const grace = config.ACCOUNT_DELETION_GRACE_DAYS * DAY_MS;
    assert.ok(due >= before + grace && due <= Date.now() + grace, 'due after the grace period');
    assert.match(res.setCookie, new RegExp(`^${config.SESSION_COOKIE}=;`), 'the cookie is cleared');

    const row = await accountRow(user.id);
    assert.equal(row?.deletionDueAt?.getTime(), due);
    assert.ok(row?.deletionRequestedAt);
    assert.equal((await db.select().from(sessions).where(eq(sessions.userId, user.id))).length, 0, 'every session ended');
    assert.ok((await auditActions(user.id)).includes('account.deletion_schedule'));
    assert.deepEqual(mailbox.at(-1)?.to, [user.email]);
    assert.match(mailbox.at(-1)!.subject, /será excluída/);
  });

  it('with two-step login on, asks for the emailed code before scheduling', async () => {
    const user = await makeAccount({ twoFactor: true });
    const first = await requestDeletion(user.cookie);
    assert.equal(first.status, 200);
    assert.equal(first.body.codeRequired, true);
    assert.notEqual(first.body.email, user.email, 'the address is masked');
    assert.equal((await accountRow(user.id))?.deletionDueAt, null, 'nothing scheduled before the code');

    const code = lastCode();
    const wrong = await confirmDeletion(user.cookie, code === '000000' ? '111111' : '000000');
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, 'invalid_code');
    assert.equal((await accountRow(user.id))?.deletionDueAt, null);

    const done = await confirmDeletion(user.cookie, code);
    assert.equal(done.status, 200);
    assert.ok(done.body.deletionDueAt);
    assert.ok((await accountRow(user.id))?.deletionDueAt);
  });

  it('refuses the last admin able to stay, and allows an admin when another one stays', async () => {
    // other admins left over from earlier tests would make this one not the last: suspend them for the test
    const others = await db.select({ id: users.id }).from(users).where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
    await db.update(users).set({ status: 'suspended' }).where(and(eq(users.role, 'admin'), eq(users.status, 'active')));
    try {
      const admin = await makeAccount({ role: 'admin' });
      const refused = await requestDeletion(admin.cookie);
      assert.equal(refused.status, 409);
      assert.equal(refused.body.error.code, 'last_admin');

      const second = await makeAccount({ role: 'admin' });
      assert.equal((await requestDeletion(second.cookie)).status, 200);
      // the second one is leaving too: the first is the last one staying again
      const again = await requestDeletion(admin.cookie);
      assert.equal(again.status, 409);
    } finally {
      for (const { id } of others) await db.update(users).set({ status: 'active' }).where(eq(users.id, id));
    }
  });
});

describe('the grace period', () => {
  it('signing in again cancels the deletion and says so', async () => {
    const user = await makeAccount();
    assert.equal((await requestDeletion(user.cookie)).status, 200);
    const res = await login(user.username);
    assert.equal(res.status, 200);
    assert.equal(res.body.deletionCancelled, true);
    const row = await accountRow(user.id);
    assert.equal(row?.deletionDueAt, null);
    assert.equal(row?.deletionRequestedAt, null);
    assert.ok((await auditActions(user.id)).includes('account.deletion_cancel'));

    const plain = await login(user.username);
    assert.equal(plain.body.deletionCancelled, undefined, 'only the sign-in that cancelled says so');
  });

  it('with two-step login on, only the finished login cancels', async () => {
    const user = await makeAccount({ twoFactor: true });
    await requestDeletion(user.cookie);
    await confirmDeletion(user.cookie, lastCode());
    const first = await login(user.username);
    assert.ok(first.body.twoFactor);
    assert.ok((await accountRow(user.id))?.deletionDueAt, 'the password alone does not cancel');
    const done = await call('/api/auth/login/verify', { challenge: first.body.twoFactor.challenge, code: lastCode() });
    assert.equal(done.status, 200);
    assert.equal(done.body.deletionCancelled, true);
    assert.equal((await accountRow(user.id))?.deletionDueAt, null);
  });

  it('once it is over, the account can no longer sign in', async () => {
    const user = await makeAccount();
    await requestDeletion(user.cookie);
    await expireGrace(user.id);
    const res = await login(user.username);
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'account_deleted');
    assert.ok((await accountRow(user.id))?.deletionDueAt, 'a late sign-in does not cancel');
  });
});

describe('the deletion sweep', () => {
  it('deletes a due account with the admin flow: server succession, empty servers, audit and email', async () => {
    const owner = await makeAccount();
    const oldest = await makeUser('del_old');
    const newer = await makeUser('del_new');
    const shared = await makeServerWithMembers(owner.id, [oldest.id, newer.id], 'shared');
    const alone = await makeServerWithMembers(owner.id, [], 'alone');

    await requestDeletion(owner.cookie);
    await expireGrace(owner.id);
    mailbox = [];
    const result = await sweepDueAccountDeletions();
    assert.ok(result.deleted >= 1);

    assert.equal(await accountRow(owner.id), null, 'the account is gone');
    assert.equal(await ownerOf(shared.serverId), oldest.id, 'the oldest member inherits the server');
    assert.equal(await memberCount(shared.serverId), 2);
    assert.equal((await db.select().from(servers).where(eq(servers.id, alone.serverId))).length, 0, 'a server left empty is removed');

    const [deletion] = await db.select().from(adminAuditLogs)
      .where(and(eq(adminAuditLogs.targetId, owner.id), eq(adminAuditLogs.action, 'user.delete')));
    assert.ok(deletion);
    assert.equal(deletion.actorId, null, 'nobody acted: the sweep did');
    const succession = await db.select().from(adminAuditLogs)
      .where(and(eq(adminAuditLogs.targetId, shared.serverId), eq(adminAuditLogs.action, 'server.owner_succession')));
    assert.equal(succession.length, 1);

    assert.ok(mailbox.some((m) => m.to[0] === owner.email && /foi excluída/.test(m.subject)), 'the person is told it is done');
  });

  it('leaves accounts still in their grace period, and those that cancelled', async () => {
    const waiting = await makeAccount();
    await requestDeletion(waiting.cookie);
    const cancelled = await makeAccount();
    await requestDeletion(cancelled.cookie);
    await login(cancelled.username);

    await sweepDueAccountDeletions();
    assert.ok(await accountRow(waiting.id));
    assert.ok(await accountRow(cancelled.id));
  });

  it('a sign-in that lands first wins over a sweep that read the account as due', async () => {
    const user = await makeAccount();
    await requestDeletion(user.cookie);
    // the sweep's clock says the grace period is over, but the person signed in before it got the lock
    await login(user.username);
    await sweepDueAccountDeletions(new Date(Date.now() + 30 * DAY_MS));
    assert.ok(await accountRow(user.id), 'the cancelled account survives');
  });
});

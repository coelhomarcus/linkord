import { uploadDir } from './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, afterEach, before, beforeEach, describe, it, mock } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import yauzl from 'yauzl';
import { config } from '../../src/config/env.js';
import {
  adminAuditLogs, attachments, conversationMembers, conversations, dataExports, friendships, messages, serverMemberRoles, serverRoles, userBlocks, users,
} from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { deleteUserAccount } from '../../src/modules/admin/adminUsers.js';
import { sweepDataExports, whenExportsIdle } from '../../src/modules/data-export/dataExport.js';
import { exportFilePath } from '../../src/modules/data-export/exportStorage.js';
import { befriend, db, makeServerWithMembers, makeUser, pool } from './helpers.js';

// "Download my data" against the real database and a throwaway uploads folder: the request and its daily
// limit, the job that builds the ZIP, what the ZIP holds (and what it must not), the emailed link, the
// download and the expiry.

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); fs.rmSync(uploadDir, { recursive: true, force: true }); });

let mailbox: { to: string[]; subject: string; text: string }[] = [];
const saved = { key: config.RESEND_API_KEY, from: config.RESEND_FROM_EMAIL, appUrl: config.APP_URL };
beforeEach(() => {
  mailbox = [];
  Object.assign(config, { RESEND_API_KEY: 're_test', RESEND_FROM_EMAIL: 'Linkord <noreply@example.test>', APP_URL: 'https://chat.example.test' });
  mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) => {
    mailbox.push(JSON.parse(String(init.body)));
    return new Response('{}', { status: 200 });
  });
});
afterEach(async () => {
  await whenExportsIdle();
  mock.restoreAll();
  Object.assign(config, { RESEND_API_KEY: saved.key, RESEND_FROM_EMAIL: saved.from, APP_URL: saved.appUrl });
});

const newFileId = () => crypto.randomUUID().replace(/-/g, '');

/** A stored file: its row and its bytes on disk, the way an upload leaves them. */
async function storeFile(opts: { messageId?: number; uploaderId?: string; fileName: string; mimeType: string; bytes: Buffer; thumbnail?: boolean }) {
  const id = newFileId();
  await db.insert(attachments).values({
    id, messageId: opts.messageId ?? null, uploaderId: opts.uploaderId ?? null, fileName: opts.fileName, mimeType: opts.mimeType,
    size: opts.bytes.length, isThumbnail: opts.thumbnail ?? false,
  });
  fs.writeFileSync(path.join(uploadDir, id), opts.bytes);
  return id;
}

async function makeAccount() {
  const user = await makeUser('exp');
  await db.update(users).set({ email: `${user.username}@example.test`, displayName: 'Ana Export', bio: 'minha bio' }).where(eq(users.id, user.id));
  const { rawToken } = await createSession(user.id);
  return { ...user, email: `${user.username}@example.test`, cookie: `${config.SESSION_COOKIE}=${rawToken}` };
}

async function makeDm(a: string, b: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(conversations).values({ id, type: 'direct', dmKey: [a, b].sort().join(':') });
  await db.insert(conversationMembers).values([{ conversationId: id, userId: a }, { conversationId: id, userId: b }]);
  return id;
}

interface Reply { status: number; headers: Record<string, unknown>; body: any; raw: Buffer }

async function call(method: 'GET' | 'POST', url: string, cookie?: string): Promise<Reply> {
  const res = await app.inject({ method, url, headers: cookie ? { cookie } : {} });
  const isJson = String(res.headers['content-type'] ?? '').includes('json');
  return { status: res.statusCode, headers: res.headers, body: isJson && res.body ? JSON.parse(res.body) : null, raw: res.rawPayload };
}

const requestExport = (cookie: string) => call('POST', '/api/account/data-export', cookie);
const exportStatus = (cookie: string) => call('GET', '/api/account/data-export', cookie);
const download = (cookie: string | undefined, id: string) => call('GET', `/api/account/data-export/${id}/download`, cookie);

/** Every entry of a ZIP, by name. */
async function unzip(buffer: Buffer): Promise<Map<string, Buffer>> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, z) => (err ? reject(err) : resolve(z!))));
  const entries = new Map<string, Buffer>();
  await new Promise<void>((resolve, reject) => {
    zip.on('entry', (entry: yauzl.Entry) => {
      zip.openReadStream(entry, (err, stream) => {
        if (err || !stream) return reject(err);
        const chunks: Buffer[] = [];
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('end', () => { entries.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry(); });
        stream.on('error', reject);
      });
    });
    zip.on('end', resolve);
    zip.on('error', reject);
    zip.readEntry();
  });
  return entries;
}

const jsonOf = (entries: Map<string, Buffer>, name: string) => JSON.parse(entries.get(name)!.toString('utf8'));

describe('asking for a copy of your data', () => {
  it('needs a session', async () => {
    assert.equal((await call('POST', '/api/account/data-export')).status, 401);
    assert.equal((await call('GET', '/api/account/data-export')).status, 401);
  });

  it('queues one export a day, audited, and a failed one does not count', async () => {
    const me = await makeAccount();
    const first = await requestExport(me.cookie);
    assert.equal(first.status, 202);
    assert.ok(['pending', 'running', 'ready'].includes(first.body.export.status));

    const again = await requestExport(me.cookie);
    assert.equal(again.status, 429);
    assert.equal(again.body.error.code, 'rate_limited');
    assert.ok(new Date(again.body.error.retryAt).getTime() > Date.now() + 23 * 60 * 60 * 1000);
    assert.ok(Number(again.headers['retry-after']) > 0);

    await whenExportsIdle();
    const audit = await db.select({ action: adminAuditLogs.action }).from(adminAuditLogs).where(eq(adminAuditLogs.targetId, me.id));
    assert.equal(audit.filter((a) => a.action === 'account.data_export_request').length, 1);

    await db.update(dataExports).set({ status: 'failed' }).where(eq(dataExports.userId, me.id));
    assert.equal((await requestExport(me.cookie)).status, 202, 'a failed export can be asked for again');
    const status = await exportStatus(me.cookie);
    assert.equal(status.body.nextRequestAt !== null, true);
  });
});

describe('the export', () => {
  it('builds a ZIP of what the account is and sent, and emails a link to it', async () => {
    const me = await makeAccount();
    const friend = await makeUser('exp_friend');
    const requester = await makeUser('exp_req');
    const blocked = await makeUser('exp_blk');
    await befriend(me.id, friend.id);
    await db.update(users).set({ displayName: 'Bia Amiga' }).where(eq(users.id, friend.id));
    // a pending request from someone else
    const [low, high] = [me.id, requester.id].sort() as [string, string];
    await db.insert(friendships).values({ id: crypto.randomUUID(), userLowId: low, userHighId: high, requestedBy: requester.id, status: 'pending' });
    await db.insert(userBlocks).values({ blockerId: me.id, blockedId: blocked.id });

    const owned = await makeServerWithMembers(me.id, [friend.id], 'Meu servidor');
    const joined = await makeServerWithMembers(friend.id, [me.id], 'Servidor da Bia');
    const [role] = await db.insert(serverRoles).values({ id: crypto.randomUUID(), serverId: joined.serverId, name: 'Moderação', position: 1 }).returning();
    await db.insert(serverMemberRoles).values({ serverId: joined.serverId, userId: me.id, roleId: role!.id });

    const avatarBytes = Buffer.from('fake jpeg bytes');
    const avatarId = await storeFile({ uploaderId: me.id, fileName: 'avatar', mimeType: 'image/jpeg', bytes: avatarBytes });
    await db.update(users).set({ avatar: `/uploads/${avatarId}` }).where(eq(users.id, me.id));

    const dm = await makeDm(me.id, friend.id);
    const [sent] = await db.insert(messages).values({ conversationId: dm, authorId: me.id, text: 'olá, segue o arquivo' }).returning();
    const fileBytes = crypto.randomBytes(2048);
    await storeFile({ messageId: sent!.id, fileName: 'relatório final.pdf', mimeType: 'application/pdf', bytes: fileBytes });
    await storeFile({ messageId: sent!.id, fileName: 'thumb', mimeType: 'image/webp', bytes: Buffer.from('thumb'), thumbnail: true });
    await db.insert(messages).values({ conversationId: owned.textChannelId, authorId: me.id, text: 'mensagem no canal' });
    await db.insert(messages).values({ conversationId: dm, authorId: friend.id, text: 'mensagem da outra pessoa' });

    assert.equal((await requestExport(me.cookie)).status, 202);
    await whenExportsIdle();

    const status = await exportStatus(me.cookie);
    assert.equal(status.body.latest.status, 'ready');
    assert.ok(status.body.latest.sizeBytes > 0);
    const exportId: string = status.body.latest.id;
    const expires = new Date(status.body.latest.expiresAt).getTime();
    assert.ok(Math.abs(expires - (Date.now() + config.DATA_EXPORT_TTL_MS)) < 60_000, 'the link lasts the export TTL');

    const mail = mailbox.find((m) => m.to[0] === me.email);
    assert.ok(mail, 'the link is emailed');
    assert.ok(mail.text.includes(`https://chat.example.test/api/account/data-export/${exportId}/download`));

    const res = await download(me.cookie, exportId);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/zip');
    assert.match(String(res.headers['content-disposition']), new RegExp(`attachment; filename="linkord-${me.username}-\\d{4}-\\d{2}-\\d{2}\\.zip"`));
    assert.equal(res.headers['cache-control'], 'no-store');

    const entries = await unzip(res.raw);
    for (const name of ['README.txt', 'account.json', 'connections.json', 'friends.json', 'blocks.json', 'servers.json', 'messages.json']) {
      assert.ok(entries.has(name), name);
    }

    const account = jsonOf(entries, 'account.json');
    assert.equal(account.account.username, me.username);
    assert.equal(account.account.email, me.email);
    assert.equal(account.profile.bio, 'minha bio');
    assert.equal(account.profile.avatarFile, 'profile/avatar.jpeg');
    assert.deepEqual(entries.get('profile/avatar.jpeg'), avatarBytes);
    assert.equal(account.settings.language, 'pt-BR');
    const everything = [...entries.values()].map((b) => b.toString('latin1')).join('\n');
    assert.ok(!everything.includes('passwordHash') && !everything.includes('password_hash'), 'no password hash anywhere');

    const friends = jsonOf(entries, 'friends.json');
    assert.deepEqual(friends.map((f: any) => [f.person.username, f.status, f.requestedByYou]).sort(), [
      [friend.username, 'accepted', true], [requester.username, 'pending', false],
    ].sort());
    assert.equal(friends.find((f: any) => f.person.id === friend.id).person.displayName, 'Bia Amiga');
    assert.deepEqual(jsonOf(entries, 'blocks.json').map((b: any) => b.person.username), [blocked.username]);

    const serverList = jsonOf(entries, 'servers.json');
    assert.deepEqual(serverList.map((s: any) => [s.name, s.owner]).sort(), [['Meu servidor', true], ['Servidor da Bia', false]]);
    assert.deepEqual(serverList.find((s: any) => s.id === joined.serverId).roles, ['Moderação']);

    const sentMessages = jsonOf(entries, 'messages.json');
    assert.deepEqual(sentMessages.map((m: any) => m.text), ['olá, segue o arquivo', 'mensagem no canal']);
    assert.ok(!everything.includes('mensagem da outra pessoa'), "other people's messages stay out");
    const [inDm, inChannel] = sentMessages;
    assert.equal(inDm.where.type, 'direct');
    assert.equal(inDm.where.with.username, friend.username);
    assert.equal(inChannel.where.type, 'channel');
    assert.equal(inChannel.where.server.name, 'Meu servidor');
    assert.equal(inDm.attachments.length, 1, 'thumbnails are left out');
    assert.equal(inDm.attachments[0].name, 'relatório final.pdf');
    assert.deepEqual(entries.get(inDm.attachments[0].file), fileBytes);
  });

  it('only the account that asked can download it, and a browser without a session is sent to settings', async () => {
    const me = await makeAccount();
    const other = await makeAccount();
    await requestExport(me.cookie);
    await whenExportsIdle();
    const { body } = await exportStatus(me.cookie);
    const res = await download(other.cookie, body.latest.id);
    assert.equal(res.status, 404);
    const anonymous = await download(undefined, body.latest.id);
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.location, '/app/settings/account#data-export');
  });

  it('expires: the link answers 410 and the sweep deletes the file', async () => {
    const me = await makeAccount();
    await requestExport(me.cookie);
    await whenExportsIdle();
    const { body } = await exportStatus(me.cookie);
    const file = exportFilePath(body.latest.id);
    assert.ok(fs.existsSync(file));
    await db.update(dataExports).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(dataExports.id, body.latest.id));

    const res = await download(me.cookie, body.latest.id);
    assert.equal(res.status, 410);
    assert.equal(res.body.error.code, 'export_expired');
    assert.equal((await exportStatus(me.cookie)).body.latest.status, 'expired');

    await sweepDataExports();
    assert.ok(!fs.existsSync(file), 'the file is gone');
    const [row] = await db.select().from(dataExports).where(eq(dataExports.id, body.latest.id));
    assert.equal(row?.status, 'expired', 'the row stays, it is what spaces requests out');
  });

  it('the sweep removes files no ready export owns', async () => {
    fs.mkdirSync(config.EXPORT_DIR, { recursive: true });
    const stray = path.join(config.EXPORT_DIR, `${crypto.randomUUID()}.zip`);
    const leftover = path.join(config.EXPORT_DIR, `${crypto.randomUUID()}.zip.part`);
    fs.writeFileSync(stray, 'x');
    fs.writeFileSync(leftover, 'x');
    await sweepDataExports();
    assert.ok(!fs.existsSync(stray));
    assert.ok(!fs.existsSync(leftover));
  });

  it("deleting the account deletes its exports' files", async () => {
    const me = await makeAccount();
    await requestExport(me.cookie);
    await whenExportsIdle();
    const { body } = await exportStatus(me.cookie);
    const file = exportFilePath(body.latest.id);
    assert.ok(fs.existsSync(file));
    const admin = await makeUser('exp_admin', 'admin');
    const result = await deleteUserAccount({ actor: admin, reason: 'teste', requestId: '' }, me.id, me.username);
    assert.equal(result.code, 'ok');
    assert.ok(!fs.existsSync(file));
  });
});

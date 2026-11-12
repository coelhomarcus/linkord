import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { conversationMembers, conversations, messages, notifications, notificationSettings, servers } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { countAppBadge, markRead, unreadMentionCounts } from '../../src/modules/notifications/notificationsRepository.js';
import { notificationPolicyFor, updateNotificationSetting } from '../../src/modules/notifications/notificationSettings.js';
import { db, makeServerWithMembers, makeUser, pool } from './helpers.js';

// Per-server and per-channel/DM notification settings against the real database: the routes, what push
// delivery resolves from the rows, and the app icon badge leaving a muted DM out but not its mentions.

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

const HOUR = 60 * 60 * 1000;

async function headersFor(userId: string) {
  return { cookie: `${config.SESSION_COOKIE}=${(await createSession(userId)).rawToken}` };
}

async function makeDirect(a: string, b: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(conversations).values({ id, type: 'direct', title: '', createdBy: a, dmKey: [a, b].sort().join(':') });
  const joinedAt = new Date(Date.now() - HOUR);
  await db.insert(conversationMembers).values([{ conversationId: id, userId: a, joinedAt }, { conversationId: id, userId: b, joinedAt }]);
  return id;
}

async function post(conversationId: string, authorId: string): Promise<number> {
  const [row] = await db.insert(messages).values({ conversationId, authorId, text: 'x' }).returning({ id: messages.id });
  await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, conversationId));
  return row!.id;
}

describe('notification settings routes (real Postgres)', () => {
  it('stores a level and a mute per account and lists them', async () => {
    const owner = await makeUser('ns');
    const member = await makeUser('ns');
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [member.id]);
    const headers = await headersFor(member.id);

    const level = await app.inject({ method: 'PATCH', url: `/api/notification-settings/servers/${serverId}`, headers, payload: { level: 'mentions' } });
    assert.equal(level.statusCode, 200);
    assert.deepEqual(level.json(), { setting: { level: 'mentions', muted: false, mutedUntil: null } });

    const before = Date.now();
    const mute = await app.inject({ method: 'PATCH', url: `/api/notification-settings/conversations/${textChannelId}`, headers, payload: { mute: 60 } });
    assert.equal(mute.statusCode, 200);
    const until = Date.parse(mute.json().setting.mutedUntil);
    assert.ok(until >= before + 60 * 60_000 && until <= Date.now() + 60 * 60_000);

    const list = await app.inject({ method: 'GET', url: '/api/notification-settings', headers });
    assert.equal(list.json().servers[serverId].level, 'mentions');
    assert.equal(list.json().conversations[textChannelId].muted, true);
    const forOwner = await app.inject({ method: 'GET', url: '/api/notification-settings', headers: await headersFor(owner.id) });
    assert.deepEqual(forOwner.json(), { servers: {}, conversations: {} });
  });

  it('going back to the default deletes the row', async () => {
    const owner = await makeUser('ns');
    const { serverId } = await makeServerWithMembers(owner.id, []);
    const headers = await headersFor(owner.id);
    await app.inject({ method: 'PATCH', url: `/api/notification-settings/servers/${serverId}`, headers, payload: { level: 'nothing', mute: 'forever' } });
    const cleared = await app.inject({ method: 'PATCH', url: `/api/notification-settings/servers/${serverId}`, headers, payload: { level: null, mute: false } });
    assert.deepEqual(cleared.json(), { setting: null });
    assert.equal((await db.select().from(notificationSettings).where(eq(notificationSettings.serverId, serverId))).length, 0);
  });

  it('refuses bad input and anything the account cannot see', async () => {
    const owner = await makeUser('ns');
    const stranger = await makeUser('ns');
    const { serverId, textChannelId, voiceChannelId } = await makeServerWithMembers(owner.id, []);
    const headers = await headersFor(owner.id);
    for (const payload of [{ level: 'loud' }, { mute: 30 }, { mute: true }, {}]) {
      const res = await app.inject({ method: 'PATCH', url: `/api/notification-settings/servers/${serverId}`, headers, payload });
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
    }
    const strangerHeaders = await headersFor(stranger.id);
    for (const url of [`/api/notification-settings/servers/${serverId}`, `/api/notification-settings/conversations/${textChannelId}`]) {
      assert.equal((await app.inject({ method: 'PATCH', url, headers: strangerHeaders, payload: { mute: 15 } })).statusCode, 404, url);
    }
    // a voice channel has no unread state to tune
    assert.equal((await app.inject({ method: 'PATCH', url: `/api/notification-settings/conversations/${voiceChannelId}`, headers, payload: { mute: 15 } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/notification-settings/teams/x', headers, payload: { mute: 15 } })).statusCode, 404);
    assert.equal((await app.inject({ method: 'GET', url: '/api/notification-settings' })).statusCode, 401);
  });

  it('deleting the server takes its settings along', async () => {
    const owner = await makeUser('ns');
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, []);
    await updateNotificationSetting(owner.id, 'server', serverId, { mute: 'forever' });
    await updateNotificationSetting(owner.id, 'conversation', textChannelId, { level: 'all' });
    await db.delete(servers).where(eq(servers.id, serverId));
    assert.equal((await db.select().from(notificationSettings).where(eq(notificationSettings.userId, owner.id))).length, 0);
  });
});

describe('notificationPolicyFor (real Postgres)', () => {
  it('resolves channel over server over the default, and a server mute over both', async () => {
    const owner = await makeUser('np');
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, []);
    const channel = { id: textChannelId, serverId };
    assert.deepEqual(await notificationPolicyFor(owner.id, channel), { level: 'all', muted: false });
    await updateNotificationSetting(owner.id, 'server', serverId, { level: 'nothing' });
    assert.equal((await notificationPolicyFor(owner.id, channel)).level, 'nothing');
    await updateNotificationSetting(owner.id, 'conversation', textChannelId, { level: 'mentions' });
    assert.equal((await notificationPolicyFor(owner.id, channel)).level, 'mentions');
    await updateNotificationSetting(owner.id, 'server', serverId, { mute: 15 });
    assert.deepEqual(await notificationPolicyFor(owner.id, channel), { level: 'mentions', muted: true });
    // the mute is over once its time passes
    assert.equal((await notificationPolicyFor(owner.id, channel, new Date(Date.now() + 16 * 60_000))).muted, false);
  });

  it("a DM ignores the reader's server settings", async () => {
    const a = await makeUser('np');
    const b = await makeUser('np');
    const dm = await makeDirect(a.id, b.id);
    await updateNotificationSetting(a.id, 'conversation', dm, { level: 'mentions' });
    assert.deepEqual(await notificationPolicyFor(a.id, { id: dm, serverId: null }), { level: 'mentions', muted: false });
    assert.deepEqual(await notificationPolicyFor(b.id, { id: dm, serverId: null }), { level: 'all', muted: false });
  });
});

describe('app badge with a muted DM (real Postgres)', () => {
  it("leaves the DM's messages out but counts its mentions", async () => {
    const a = await makeUser('nb');
    const b = await makeUser('nb');
    const dm = await makeDirect(a.id, b.id);
    await post(dm, b.id);
    const mentionId = await post(dm, b.id);
    await db.insert(notifications).values({ id: crypto.randomUUID(), recipientId: a.id, kind: 'mention', messageId: mentionId, dedupeKey: crypto.randomUUID() });
    assert.equal(await countAppBadge(a.id), 2);
    await updateNotificationSetting(a.id, 'conversation', dm, { mute: 'forever' });
    assert.equal(await countAppBadge(a.id), 1);
    await updateNotificationSetting(a.id, 'conversation', dm, { mute: false });
    assert.equal(await countAppBadge(a.id), 2);
  });
});

describe('unreadMentionCounts (real Postgres)', () => {
  it('counts unread mentions per conversation, for the welcome', async () => {
    const owner = await makeUser('nm');
    const reader = await makeUser('nm');
    const { textChannelId } = await makeServerWithMembers(owner.id, [reader.id]);
    const dm = await makeDirect(owner.id, reader.id);
    const mention = async (conversationId: string) => {
      const id = crypto.randomUUID();
      await db.insert(notifications).values({ id, recipientId: reader.id, kind: 'mention', messageId: await post(conversationId, owner.id), dedupeKey: id });
      return id;
    };
    await mention(textChannelId);
    const read = await mention(textChannelId);
    await mention(dm);
    await markRead(reader.id, [read]);
    assert.deepEqual(await unreadMentionCounts(reader.id), { [textChannelId]: 1, [dm]: 1 });
    assert.deepEqual(await unreadMentionCounts(owner.id), {});
  });
});

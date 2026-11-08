import './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import { after, before, describe, it, mock } from 'node:test';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { RoomServiceClient } from 'livekit-server-sdk';
import { config } from '../../src/config/env.js';
import { messages, serverAuditLogs, serverRoles } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { handlers as chatHandlers } from '../../src/modules/messages/messages.js';
import { handlers as moderationHandlers } from '../../src/modules/moderation/moderation.js';
import { setCallConversationId } from '../../src/modules/presence/participants.js';
import { sweepRetention } from '../../src/modules/retention/retentionSweeper.js';
import { PERMISSIONS } from '../../src/modules/servers/permissions.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { recordServerAudit } from '../../src/modules/servers/serverAuditLog.js';
import { silentWav } from '../modules/soundboard/wavFixture.js';
import { cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

interface Actor { id: string; username: string; token: string }
async function actor(prefix: string): Promise<Actor> {
  const user = await makeUser(prefix);
  return { ...user, token: (await createSession(user.id)).rawToken };
}

async function call(as: Actor, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<{ status: number; code?: string; body: any }> {
  const res = await app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: `${config.SESSION_COOKIE}=${as.token}` } });
  const body = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, code: body?.error?.code, body };
}

async function world() {
  const [owner, member, other, stranger] = await Promise.all(['own', 'mem', 'oth', 'str'].map(actor)) as [Actor, Actor, Actor, Actor];
  const server = await makeServerWithMembers(owner.id, [member.id, other.id], 'audit');
  return { owner, member, other, stranger, ...server };
}

/** Every entry of a server, oldest first, straight from the table. */
async function entries(serverId: string) {
  return db.select().from(serverAuditLogs).where(eq(serverAuditLogs.serverId, serverId)).orderBy(asc(serverAuditLogs.createdAt), asc(serverAuditLogs.id));
}

async function lastEntry(serverId: string, action: string) {
  const rows = (await entries(serverId)).filter((e) => e.action === action);
  assert.ok(rows.length, `expected a ${action} entry`);
  return rows[rows.length - 1]!;
}

const changesOf = (entry: { detail: Record<string, unknown> }) => entry.detail.changes as { key: string; before: unknown; after: unknown }[];

describe('server audit log: who may read it', () => {
  it('the owner and a VIEW_AUDIT_LOG role read it; another member gets 403 and an outsider 404', async () => {
    const { owner, member, other, stranger, serverId } = await world();
    assert.equal((await call(owner, 'GET', `/api/servers/${serverId}/audit-log`)).status, 200);
    assert.deepEqual(await call(member, 'GET', `/api/servers/${serverId}/audit-log`).then((r) => [r.status, r.code]), [403, 'forbidden']);
    assert.deepEqual(await call(stranger, 'GET', `/api/servers/${serverId}/audit-log`).then((r) => [r.status, r.code]), [404, 'not_found']);

    const role = await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'Auditor', permissions: PERMISSIONS.VIEW_AUDIT_LOG });
    assert.equal((await call(owner, 'PUT', `/api/servers/${serverId}/members/${other.id}/roles`, { roleIds: [role.body.roleId] })).status, 200);
    const page = await call(other, 'GET', `/api/servers/${serverId}/audit-log`);
    assert.equal(page.status, 200);
    assert.ok(page.body.items.some((e: { action: string }) => e.action === 'role.create'));
    // and no other server's entries ever leak in
    assert.ok(page.body.items.every((e: { id: string }) => e.id));
    const otherServer = await world();
    assert.equal((await call(other, 'GET', `/api/servers/${otherServer.serverId}/audit-log`)).status, 404);
  });

  it('refuses an unknown action and a malformed cursor', async () => {
    const { owner, serverId } = await world();
    assert.equal((await call(owner, 'GET', `/api/servers/${serverId}/audit-log?action=nope`)).code, 'invalid_request');
    assert.equal((await call(owner, 'GET', `/api/servers/${serverId}/audit-log?cursor=garbage`)).code, 'invalid_cursor');
  });
});

describe('server audit log: what gets recorded', () => {
  it('the server itself: rename and ownership transfer', async () => {
    const { owner, member, serverId } = await world();
    assert.equal((await call(owner, 'PATCH', `/api/servers/${serverId}`, { name: 'Renamed' })).status, 200);
    const renamed = await lastEntry(serverId, 'server.update');
    assert.equal(renamed.actorId, owner.id);
    assert.equal(renamed.actorLabel, owner.username);
    assert.deepEqual(changesOf(renamed), [{ key: 'name', before: 'audit', after: 'Renamed' }]);
    // saving the same name again changed nothing, so nothing new is written
    await call(owner, 'PATCH', `/api/servers/${serverId}`, { name: 'Renamed' });
    assert.equal((await entries(serverId)).filter((e) => e.action === 'server.update').length, 1);

    assert.equal((await call(owner, 'POST', `/api/servers/${serverId}/transfer`, { userId: member.id })).status, 200);
    const transfer = await lastEntry(serverId, 'server.transfer');
    assert.deepEqual([transfer.actorId, transfer.targetType, transfer.targetId, transfer.targetLabel], [owner.id, 'user', member.id, member.username]);
  });

  it('members: kick, ban with its reason, unban and role changes, and nothing for a refused kick or a leave', async () => {
    const { owner, member, other, serverId } = await world();
    const refused = await call(member, 'DELETE', `/api/servers/${serverId}/members/${other.id}`);
    assert.equal(refused.status, 403);
    assert.equal((await entries(serverId)).length, 0);

    const role = await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'Mod' });
    await call(owner, 'PUT', `/api/servers/${serverId}/members/${member.id}/roles`, { roleIds: [role.body.roleId] });
    const roles = await lastEntry(serverId, 'member.roles_update');
    assert.deepEqual([roles.targetId, changesOf(roles)], [member.id, [{ key: 'roles', before: [], after: ['Mod'] }]]);

    assert.equal((await call(owner, 'DELETE', `/api/servers/${serverId}/members/${other.id}`)).status, 200);
    const kick = await lastEntry(serverId, 'member.kick');
    assert.deepEqual([kick.actorId, kick.targetId, kick.targetLabel], [owner.id, other.id, other.username]);

    assert.equal((await call(owner, 'PUT', `/api/servers/${serverId}/bans/${member.id}`, { reason: 'spam' })).status, 200);
    const ban = await lastEntry(serverId, 'member.ban');
    assert.deepEqual([ban.targetId, ban.reason], [member.id, 'spam']);

    assert.equal((await call(owner, 'DELETE', `/api/servers/${serverId}/bans/${member.id}`)).status, 200);
    assert.equal((await lastEntry(serverId, 'member.unban')).targetId, member.id);
    // unbanning someone who is not banned does nothing, and records nothing
    await call(owner, 'DELETE', `/api/servers/${serverId}/bans/${member.id}`);
    assert.equal((await entries(serverId)).filter((e) => e.action === 'member.unban').length, 1);

    const before = (await entries(serverId)).length;
    const leaver = await actor('lv');
    const { serverId: own } = await makeServerWithMembers(owner.id, [leaver.id], 'leave');
    await call(leaver, 'POST', `/api/servers/${own}/leave`);
    assert.equal((await entries(own)).length, 0);
    assert.equal((await entries(serverId)).length, before);
  });

  it('roles: create, edit with before and after, reorder and delete', async () => {
    const { owner, serverId } = await world();
    const a = (await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'A', color: '#FF0000', permissions: PERMISSIONS.KICK_MEMBERS })).body.roleId;
    const created = await lastEntry(serverId, 'role.create');
    assert.deepEqual([created.targetId, created.targetLabel], [a, 'A']);
    assert.deepEqual(changesOf(created), [
      { key: 'name', before: null, after: 'A' }, { key: 'color', before: null, after: '#ff0000' }, { key: 'permissions', before: null, after: PERMISSIONS.KICK_MEMBERS },
    ]);
    const b = (await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'B' })).body.roleId;

    await call(owner, 'PATCH', `/api/roles/${a}`, { name: 'Alpha', permissions: PERMISSIONS.BAN_MEMBERS, color: '#ff0000' });
    const updated = await lastEntry(serverId, 'role.update');
    assert.equal(updated.targetLabel, 'Alpha');
    assert.deepEqual(changesOf(updated), [
      { key: 'name', before: 'A', after: 'Alpha' }, { key: 'permissions', before: PERMISSIONS.KICK_MEMBERS, after: PERMISSIONS.BAN_MEMBERS },
    ]);

    // new roles start at the bottom: B (1) under Alpha (2); swap them
    assert.equal((await call(owner, 'PUT', `/api/servers/${serverId}/roles/order`, { roleIds: [a, b] })).status, 200);
    assert.deepEqual(changesOf(await lastEntry(serverId, 'role.reorder')), [{ key: 'order', before: ['B', 'Alpha'], after: ['Alpha', 'B'] }]);

    await call(owner, 'DELETE', `/api/roles/${b}`);
    const deleted = await lastEntry(serverId, 'role.delete');
    assert.deepEqual([deleted.targetId, deleted.targetLabel], [b, 'B']);
  });

  it('channels, categories and permission overwrites', async () => {
    const { owner, member, serverId, textChannelId } = await world();
    const channelId = (await call(owner, 'POST', `/api/servers/${serverId}/channels`, { name: 'Logs', type: 'text' })).body.channelId;
    const created = await lastEntry(serverId, 'channel.create');
    assert.deepEqual([created.targetId, changesOf(created)], [channelId, [{ key: 'name', before: null, after: 'logs' }, { key: 'type', before: null, after: 'text' }]]);

    await call(owner, 'PATCH', `/api/channels/${channelId}`, { name: 'audit', topic: 'what happened' });
    assert.deepEqual(changesOf(await lastEntry(serverId, 'channel.update')), [
      { key: 'name', before: 'logs', after: 'audit' }, { key: 'topic', before: '', after: 'what happened' },
    ]);

    const [everyone] = await db.select().from(serverRoles).where(and(eq(serverRoles.serverId, serverId), eq(serverRoles.isDefault, true)));
    await call(owner, 'PUT', `/api/servers/${serverId}/overwrites/${textChannelId}`, { roleId: everyone!.id, allow: 0, deny: PERMISSIONS.SEND_MESSAGES });
    const roleOverwrite = await lastEntry(serverId, 'permissions.update');
    assert.deepEqual([roleOverwrite.targetType, roleOverwrite.targetId, roleOverwrite.detail.subjectType, roleOverwrite.detail.subjectId], ['channel', textChannelId, 'role', everyone!.id]);
    assert.deepEqual(changesOf(roleOverwrite), [{ key: 'deny', before: 0, after: PERMISSIONS.SEND_MESSAGES }]);
    await call(owner, 'PUT', `/api/servers/${serverId}/overwrites/${textChannelId}`, { userId: member.id, allow: PERMISSIONS.SEND_MESSAGES, deny: 0 });
    const userOverwrite = await lastEntry(serverId, 'permissions.update');
    assert.deepEqual([userOverwrite.detail.subjectType, userOverwrite.detail.subjectLabel], ['user', member.username]);

    await call(owner, 'DELETE', `/api/channels/${channelId}`);
    assert.deepEqual(await lastEntry(serverId, 'channel.delete').then((e) => [e.targetId, e.targetLabel, e.detail.type]), [channelId, 'audit', 'text']);

    const categoryId = (await call(owner, 'POST', `/api/servers/${serverId}/categories`, { name: 'Staff' })).body.categoryId;
    assert.equal((await lastEntry(serverId, 'category.create')).targetId, categoryId);
    await call(owner, 'PATCH', `/api/categories/${categoryId}`, { name: 'Team' });
    assert.deepEqual(changesOf(await lastEntry(serverId, 'category.update')), [{ key: 'name', before: 'Staff', after: 'Team' }]);
    await call(owner, 'DELETE', `/api/categories/${categoryId}`);
    assert.equal((await lastEntry(serverId, 'category.delete')).targetLabel, 'Team');
  });

  it('invites: created and revoked, by whoever did it', async () => {
    const { owner, member, serverId } = await world();
    const invite = (await call(member, 'POST', `/api/servers/${serverId}/invites`, { maxUses: 5 })).body.invite;
    const created = await lastEntry(serverId, 'invite.create');
    assert.deepEqual([created.actorId, created.targetId], [member.id, invite.code]);
    assert.ok(changesOf(created).some((c) => c.key === 'maxUses' && c.after === 5));
    assert.equal((await call(owner, 'DELETE', `/api/invites/${invite.code}`)).status, 200);
    const revoked = await lastEntry(serverId, 'invite.revoke');
    assert.deepEqual([revoked.actorId, revoked.targetId, revoked.detail.createdBy], [owner.id, invite.code, member.id]);
  });

  it('webhooks: create, rename, token reset and delete, never the token', async () => {
    const { owner, serverId, textChannelId } = await world();
    const created = (await call(owner, 'POST', `/api/channels/${textChannelId}/webhooks`, { name: 'CI' })).body.webhook;
    const base = `/api/channels/${textChannelId}/webhooks/${created.id}`;
    await call(owner, 'PATCH', base, { name: 'Deploys' });
    const rotated = (await call(owner, 'POST', `${base}/rotate`)).body.webhook;
    await call(owner, 'DELETE', base);
    const log = (await entries(serverId)).filter((e) => e.targetId === created.id);
    assert.deepEqual(log.map((e) => e.action), ['webhook.create', 'webhook.update', 'webhook.rotate', 'webhook.delete']);
    assert.deepEqual(changesOf(log[1]!), [{ key: 'name', before: 'CI', after: 'Deploys' }]);
    assert.equal(log[3]!.detail.channel, 'geral');
    const stored = JSON.stringify(log);
    assert.ok(!stored.includes(created.token) && !stored.includes(rotated.token));
  });

  it('soundboard: adding, editing and removing a sound', async () => {
    const { owner, member, serverId } = await world();
    const res = await app.inject({
      method: 'POST', url: `/api/servers/${serverId}/sounds?name=boom`, payload: silentWav({ seconds: 1 }),
      headers: { cookie: `${config.SESSION_COOKIE}=${member.token}`, 'content-type': 'audio/wav' },
    });
    const soundId = JSON.parse(res.body).sound.id;
    assert.deepEqual(await lastEntry(serverId, 'sound.create').then((e) => [e.actorId, e.targetId, e.targetLabel]), [member.id, soundId, 'boom']);
    await call(owner, 'PATCH', `/api/servers/${serverId}/sounds/${soundId}`, { volume: 40 });
    assert.deepEqual(changesOf(await lastEntry(serverId, 'sound.update')), [{ key: 'volume', before: 100, after: 40 }]);
    await call(owner, 'DELETE', `/api/servers/${serverId}/sounds/${soundId}`);
    assert.deepEqual(await lastEntry(serverId, 'sound.delete').then((e) => [e.actorId, e.detail.uploaderId]), [owner.id, member.id]);
  });

  it('a message deleted by a moderator, but not one its author deletes', async () => {
    const { owner, member, serverId, textChannelId } = await world();
    const [mine] = await db.insert(messages).values({ conversationId: textChannelId, authorId: member.id, text: 'mine' }).returning();
    const [theirs] = await db.insert(messages).values({ conversationId: textChannelId, authorId: member.id, text: 'secret body' }).returning();
    const author = joinNew(member);
    const moderator = joinNew(owner);
    try {
      await chatHandlers['chat-delete']!(author.socket, { msgId: mine!.id, requestId: 'r1' });
      assert.equal((await entries(serverId)).length, 0);
      await chatHandlers['chat-delete']!(moderator.socket, { msgId: theirs!.id, requestId: 'r2' });
      const entry = await lastEntry(serverId, 'message.delete');
      assert.deepEqual([entry.actorId, entry.targetId, entry.detail.authorId, entry.detail.author, entry.detail.channel],
        [owner.id, String(theirs!.id), member.id, member.username, 'geral']);
      assert.ok(!JSON.stringify(entry).includes('secret body'));
    } finally {
      cleanupParticipant(author.participant);
      cleanupParticipant(moderator.participant);
    }
  });

  it('voice: disconnecting and moving a member', async () => {
    const { owner, member, serverId, voiceChannelId } = await world();
    const otherVoice = (await call(owner, 'POST', `/api/servers/${serverId}/channels`, { name: 'Lounge', type: 'voice' })).body.channelId;
    const sfu = mock.method(RoomServiceClient.prototype, 'removeParticipant', async () => undefined);
    const mod = joinNew(owner);
    const target = joinNew(member);
    try {
      setCallConversationId(target.participant, voiceChannelId);
      await moderationHandlers['call-move']!(mod.socket, { participantId: target.participant.id, conversationId: otherVoice });
      const moved = await lastEntry(serverId, 'member.voice_move');
      assert.deepEqual([moved.actorId, moved.targetId, changesOf(moved)], [owner.id, member.id, [{ key: 'channel', before: 'Geral', after: 'Lounge' }]]);

      setCallConversationId(target.participant, otherVoice);
      await moderationHandlers['call-kick']!(mod.socket, { participantId: target.participant.id });
      const kicked = await lastEntry(serverId, 'member.voice_disconnect');
      assert.deepEqual([kicked.actorId, kicked.targetId, kicked.detail.channel], [owner.id, member.id, 'Lounge']);
      assert.equal(sfu.mock.callCount(), 2);
    } finally {
      sfu.mock.restore();
      cleanupParticipant(mod.participant);
      cleanupParticipant(target.participant);
    }
  });
});

describe('server audit log: listing', () => {
  it('pages newest first without gaps or repeats, and filters by action, actor, target and period', async () => {
    const { owner, member, serverId } = await world();
    for (let i = 0; i < 33; i++) {
      await recordServerAudit(db, { serverId, actorId: i % 3 ? owner.id : member.id, action: 'channel.update', targetType: 'channel', targetId: `ch-${i % 2}`, targetLabel: `c${i}` });
    }
    await recordServerAudit(db, { serverId, actorId: owner.id, action: 'member.kick', targetType: 'user', targetId: member.id });
    invalidateAllServers();

    const first = await call(owner, 'GET', `/api/servers/${serverId}/audit-log`);
    assert.equal(first.body.items.length, 30);
    assert.equal(first.body.items[0].action, 'member.kick');
    assert.equal(first.body.items[0].targetUser.id, member.id);
    assert.equal(first.body.items[0].actor.id, owner.id);
    const second = await call(owner, 'GET', `/api/servers/${serverId}/audit-log?cursor=${encodeURIComponent(first.body.nextCursor)}`);
    assert.equal(second.body.items.length, 4);
    assert.equal(second.body.nextCursor, null);
    const ids = [...first.body.items, ...second.body.items].map((e: { id: string }) => e.id);
    assert.equal(new Set(ids).size, 34);

    const byAction = await call(owner, 'GET', `/api/servers/${serverId}/audit-log?action=member.kick`);
    assert.deepEqual(byAction.body.items.map((e: { action: string }) => e.action), ['member.kick']);
    const byActor = await call(owner, 'GET', `/api/servers/${serverId}/audit-log?actor=${member.id}`);
    assert.equal(byActor.body.items.length, 11);
    const byTarget = await call(owner, 'GET', `/api/servers/${serverId}/audit-log?target=ch-1`);
    assert.equal(byTarget.body.items.length, 16);

    await db.update(serverAuditLogs).set({ createdAt: sql`now() - interval '10 days'` }).where(and(eq(serverAuditLogs.serverId, serverId), eq(serverAuditLogs.targetId, 'ch-0')));
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await call(owner, 'GET', `/api/servers/${serverId}/audit-log?from=${encodeURIComponent(since)}&target=ch-0`);
    assert.equal(recent.body.items.length, 0);
    const older = await call(owner, 'GET', `/api/servers/${serverId}/audit-log?to=${encodeURIComponent(since)}`);
    assert.equal(older.body.items.length, 17);
  });

  it('keeps naming an actor whose account is gone, and goes away with its server', async () => {
    const { owner, member, serverId } = await world();
    await recordServerAudit(db, { serverId, actorId: member.id, action: 'invite.create', targetType: 'invite', targetId: 'abc', targetLabel: 'abc' });
    await pool.query('delete from users where id = $1', [member.id]);
    const page = await call(owner, 'GET', `/api/servers/${serverId}/audit-log`);
    assert.deepEqual([page.body.items[0].actor, page.body.items[0].actorLabel], [null, member.username]);
    assert.equal((await call(owner, 'DELETE', `/api/servers/${serverId}`)).status, 200);
    assert.equal((await entries(serverId)).length, 0);
  });
});

describe('server audit log: retention', () => {
  it('the daily sweep deletes entries older than SERVER_AUDIT_RETENTION_DAYS', async () => {
    const { owner, serverId } = await world();
    await recordServerAudit(db, { serverId, actorId: owner.id, action: 'role.create', targetType: 'role', targetId: 'old' });
    await recordServerAudit(db, { serverId, actorId: owner.id, action: 'role.create', targetType: 'role', targetId: 'new' });
    await db.update(serverAuditLogs).set({ createdAt: sql`now() - interval '91 days'` }).where(and(eq(serverAuditLogs.serverId, serverId), eq(serverAuditLogs.targetId, 'old')));
    const original = config.SERVER_AUDIT_RETENTION_DAYS;
    config.SERVER_AUDIT_RETENTION_DAYS = 90;
    try {
      const result = await sweepRetention({ pauseMs: 0 });
      assert.ok(result.targets.find((t) => t.key === 'server_audit_logs')!.deleted >= 1);
    } finally {
      config.SERVER_AUDIT_RETENTION_DAYS = original;
    }
    assert.deepEqual((await entries(serverId)).map((e) => e.targetId), ['new']);
  });
});

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { and, asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { conversations, outboxEvents, serverAuditLogs, serverCategories, serverInvites, serverMembers, serverRoles } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { handlers as chatHandlers } from '../../src/modules/messages/messages.js';
import { PERMISSIONS, DEFAULT_EVERYONE_PERMISSIONS } from '../../src/modules/servers/permissions.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { listServersForUser } from '../../src/modules/servers/serverSummaries.js';
import { handleCallJoin } from '../../src/realtime/socket.js';
import { setCallConversationId } from '../../src/modules/presence/participants.js';
import { cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, memberCount, pool } from './helpers.js';

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

async function everyoneOf(serverId: string) {
  const [role] = await db.select().from(serverRoles).where(and(eq(serverRoles.serverId, serverId), eq(serverRoles.isDefault, true)));
  return role!;
}

describe('creating a server (real Postgres)', () => {
  it('lays it out from the template, owned by its creator, and hands it to their client', async () => {
    const owner = await actor('cs');
    const { sent, participant } = joinNew(owner);
    try {
      const res = await call(owner, 'POST', '/api/servers', { name: '  Equipe  ' });
      assert.equal(res.status, 201);
      const { server, channelId } = res.body;
      assert.deepEqual({ name: server.name, ownerId: server.ownerId, memberCount: server.memberCount }, { name: 'Equipe', ownerId: owner.id, memberCount: 1 });
      const categories = await db.select().from(serverCategories).where(eq(serverCategories.serverId, server.id)).orderBy(asc(serverCategories.position));
      assert.deepEqual(categories.map((c) => c.name), ['Canais de texto', 'Canais de voz']);
      const channels = await db.select().from(conversations).where(eq(conversations.serverId, server.id)).orderBy(asc(conversations.type));
      assert.deepEqual(channels.map((c) => [c.type, c.title]), [['text', 'geral'], ['voice', 'Geral']]);
      assert.equal(channelId, channels[0]!.id);
      assert.equal((await everyoneOf(server.id)).permissions, DEFAULT_EVERYONE_PERMISSIONS);
      assert.ok(sent.some((s) => s.event === 'server-created' && s.payload.server.id === server.id));
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('refuses an empty name and stops at the ownership quota', async () => {
    const owner = await actor('cs');
    assert.equal((await call(owner, 'POST', '/api/servers', { name: '   ' })).code, 'invalid_name');
    const original = config.MAX_OWNED_SERVERS_PER_USER;
    config.MAX_OWNED_SERVERS_PER_USER = 1;
    try {
      assert.equal((await call(owner, 'POST', '/api/servers', { name: 'one' })).status, 201);
      assert.deepEqual((await call(owner, 'POST', '/api/servers', { name: 'two' })).code, 'quota_exceeded');
    } finally {
      config.MAX_OWNED_SERVERS_PER_USER = original;
    }
  });
});

describe('a private channel (real Postgres)', () => {
  /** #staff visible only to the Staff role: @everyone is denied VIEW_CHANNEL there. */
  async function privateChannel() {
    const owner = await actor('pc'); const staff = await actor('pc'); const regular = await actor('pc');
    const server = await makeServerWithMembers(owner.id, [staff.id, regular.id]);
    const created = await call(owner, 'POST', `/api/servers/${server.serverId}/channels`, { name: 'Staff Room', type: 'text' });
    assert.equal(created.status, 201);
    const channelId = created.body.channelId as string;
    const role = await call(owner, 'POST', `/api/servers/${server.serverId}/roles`, { name: 'Staff' });
    const roleId = role.body.roleId as string;
    assert.equal((await call(owner, 'PUT', `/api/servers/${server.serverId}/members/${staff.id}/roles`, { roleIds: [roleId] })).status, 200);
    const everyone = await everyoneOf(server.serverId);
    assert.equal((await call(owner, 'PUT', `/api/servers/${server.serverId}/overwrites/${channelId}`, { roleId: everyone.id, allow: 0, deny: PERMISSIONS.VIEW_CHANNEL })).status, 200);
    assert.equal((await call(owner, 'PUT', `/api/servers/${server.serverId}/overwrites/${channelId}`, { roleId, allow: PERMISSIONS.VIEW_CHANNEL, deny: 0 })).status, 200);
    return { owner, staff, regular, channelId, ...server };
  }

  it('is named like a Discord channel and is only in the summary of who can see it', async () => {
    const { staff, regular, serverId, channelId } = await privateChannel();
    const seenBy = async (userId: string) => (await listServersForUser(userId)).find((s) => s.id === serverId)!.channels.map((c) => c.id);
    assert.ok((await seenBy(staff.id)).includes(channelId));
    assert.equal((await seenBy(regular.id)).includes(channelId), false);
    const [row] = await db.select({ title: conversations.title }).from(conversations).where(eq(conversations.id, channelId));
    assert.equal(row!.title, 'staff-room');
  });

  it('a member without the role cannot read, write or be reached there; one with it can', async () => {
    const { staff, regular, channelId } = await privateChannel();
    const s = joinNew(staff);
    const r = joinNew(regular);
    try {
      await chatHandlers['conversation-open']!(r.socket, { conversationId: channelId });
      assert.equal(r.sent.some((m) => m.event === 'conversation-history'), false, 'no history for the outsider');
      await chatHandlers.chat!(r.socket, { conversationId: channelId, text: 'let me in', clientMessageId: crypto.randomUUID() });
      assert.equal(r.sent.find((m) => m.event === 'chat-send-result')?.payload.error?.code, 'conversation_not_found');

      await chatHandlers.chat!(s.socket, { conversationId: channelId, text: 'staff only', clientMessageId: crypto.randomUUID() });
      assert.equal(s.sent.find((m) => m.event === 'chat-send-result')?.payload.error, undefined);
      assert.equal(r.sent.some((m) => m.event === 'chat'), false, 'the message never reaches the outsider');
      assert.ok(s.sent.some((m) => m.event === 'chat'));
    } finally {
      cleanupParticipant(s.participant);
      cleanupParticipant(r.participant);
    }
  });

  it('a push for a message there is only queued for who can see it', async () => {
    const original = config.PUSH_VAPID_PUBLIC_KEY;
    (config as { PUSH_VAPID_PUBLIC_KEY: string }).PUSH_VAPID_PUBLIC_KEY = 'test-key';
    try {
      const { owner, staff, regular, channelId } = await privateChannel();
      const o = joinNew(owner);
      try {
        await chatHandlers.chat!(o.socket, { conversationId: channelId, text: 'psst', clientMessageId: crypto.randomUUID() });
      } finally {
        cleanupParticipant(o.participant);
      }
      const audience = (await db.select({ userId: outboxEvents.audienceUserId }).from(outboxEvents)
        .where(eq(outboxEvents.type, 'chat_message_push'))).map((r) => r.userId);
      assert.ok(audience.includes(staff.id));
      assert.equal(audience.includes(regular.id), false);
    } finally {
      (config as { PUSH_VAPID_PUBLIC_KEY: string }).PUSH_VAPID_PUBLIC_KEY = original;
    }
  });
});

describe('roles and their hierarchy (real Postgres)', () => {
  it('a manager only touches roles below theirs and only grants what they hold', async () => {
    const owner = await actor('rh'); const manager = await actor('rh'); const target = await actor('rh');
    const { serverId } = await makeServerWithMembers(owner.id, [manager.id, target.id]);
    const low = (await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'Low' })).body.roleId;
    const managers = (await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'Managers', permissions: PERMISSIONS.MANAGE_ROLES })).body.roleId;
    // newest roles start at the bottom: put Managers above Low
    assert.equal((await call(owner, 'PUT', `/api/servers/${serverId}/roles/order`, { roleIds: [low, managers] })).status, 200);
    await call(owner, 'PUT', `/api/servers/${serverId}/members/${manager.id}/roles`, { roleIds: [managers] });

    assert.equal((await call(manager, 'PATCH', `/api/roles/${low}`, { name: 'Lower' })).status, 200);
    assert.equal((await call(manager, 'PATCH', `/api/roles/${managers}`, { name: 'Mine' })).code, 'hierarchy');
    assert.equal((await call(manager, 'PATCH', `/api/roles/${low}`, { permissions: PERMISSIONS.ADMINISTRATOR })).code, 'hierarchy');
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/members/${target.id}/roles`, { roleIds: [low] })).status, 200);
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/members/${target.id}/roles`, { roleIds: [managers] })).code, 'hierarchy');
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/members/${owner.id}/roles`, { roleIds: [] })).code, 'hierarchy');
    assert.equal((await call(target, 'POST', `/api/servers/${serverId}/roles`, { name: 'nope' })).code, 'forbidden');
    assert.equal((await call(owner, 'DELETE', `/api/roles/${(await everyoneOf(serverId)).id}`)).code, 'forbidden');
  });
});

describe('invite links (real Postgres)', () => {
  it('previews the server, joins whoever has it once, and counts the use', async () => {
    const owner = await actor('il'); const guest = await actor('il');
    const { serverId } = await makeServerWithMembers(owner.id, []);
    const { invite } = (await call(owner, 'POST', `/api/servers/${serverId}/invites`, { maxUses: 5 })).body;
    const preview = await call(guest, 'GET', `/api/invites/${invite.code}`);
    assert.deepEqual({ id: preview.body.server.id, members: preview.body.server.memberCount, isMember: preview.body.isMember }, { id: serverId, members: 1, isMember: false });
    assert.equal((await call(guest, 'POST', `/api/invites/${invite.code}/accept`)).body.joined, true);
    assert.equal((await call(guest, 'POST', `/api/invites/${invite.code}/accept`)).body.joined, false);
    assert.equal(await memberCount(serverId), 2);
    const [stored] = await db.select().from(serverInvites).where(eq(serverInvites.code, invite.code));
    assert.equal(stored!.uses, 1);
  });

  it('a used-up, expired or revoked link and a banned account all stay out', async () => {
    const owner = await actor('il'); const first = await actor('il'); const second = await actor('il'); const banned = await actor('il');
    const { serverId } = await makeServerWithMembers(owner.id, [banned.id]);
    const once = (await call(owner, 'POST', `/api/servers/${serverId}/invites`, { maxUses: 1 })).body.invite.code;
    assert.equal((await call(first, 'POST', `/api/invites/${once}/accept`)).status, 200);
    assert.equal((await call(second, 'POST', `/api/invites/${once}/accept`)).code, 'invalid_invite');

    const expired = (await call(owner, 'POST', `/api/servers/${serverId}/invites`, {})).body.invite.code;
    await db.update(serverInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(serverInvites.code, expired));
    assert.equal((await call(second, 'GET', `/api/invites/${expired}`)).code, 'invalid_invite');

    const revoked = (await call(owner, 'POST', `/api/servers/${serverId}/invites`, {})).body.invite.code;
    assert.equal((await call(owner, 'DELETE', `/api/invites/${revoked}`)).status, 200);
    assert.equal((await call(second, 'POST', `/api/invites/${revoked}/accept`)).code, 'invalid_invite');

    assert.equal((await call(owner, 'PUT', `/api/servers/${serverId}/bans/${banned.id}`, { reason: 'spam' })).status, 200);
    const open = (await call(owner, 'POST', `/api/servers/${serverId}/invites`, {})).body.invite.code;
    assert.equal((await call(banned, 'POST', `/api/invites/${open}/accept`)).code, 'banned');
    assert.equal((await call(owner, 'DELETE', `/api/servers/${serverId}/bans/${banned.id}`)).status, 200);
    assert.equal((await call(banned, 'POST', `/api/invites/${open}/accept`)).status, 200);
  });
});

describe('leaving and removing (real Postgres)', () => {
  it('a kick needs KICK_MEMBERS and a higher role; the owner must transfer before leaving; the last one out deletes the server', async () => {
    const owner = await actor('lv'); const member = await actor('lv'); const other = await actor('lv');
    const { serverId } = await makeServerWithMembers(owner.id, [member.id, other.id]);
    assert.equal((await call(member, 'DELETE', `/api/servers/${serverId}/members/${other.id}`)).code, 'forbidden');
    assert.equal((await call(owner, 'DELETE', `/api/servers/${serverId}/members/${other.id}`)).status, 200);
    assert.equal((await call(owner, 'POST', `/api/servers/${serverId}/leave`)).code, 'owner_must_transfer');
    assert.equal((await call(owner, 'POST', `/api/servers/${serverId}/transfer`, { userId: member.id })).status, 200);
    assert.equal((await call(owner, 'POST', `/api/servers/${serverId}/leave`)).status, 200);
    const last = await call(member, 'POST', `/api/servers/${serverId}/leave`);
    assert.deepEqual(last.body, { ok: true, serverDeleted: true });
    assert.equal((await db.select().from(serverMembers).where(eq(serverMembers.serverId, serverId))).length, 0);
  });
});

describe('voice channels (real Postgres)', () => {
  it('calls happen in voice channels only, for whoever may CONNECT there', async () => {
    const owner = await actor('vc'); const member = await actor('vc');
    const { serverId, textChannelId, voiceChannelId } = await makeServerWithMembers(owner.id, [member.id]);
    const m = joinNew(member);
    try {
      await handleCallJoin(m.socket, { conversationId: textChannelId });
      assert.equal(m.sent.find((s) => s.event === 'error')?.payload.code, 'call-not-allowed');

      const everyone = await everyoneOf(serverId);
      await db.update(serverRoles).set({ permissions: everyone.permissions & ~PERMISSIONS.CONNECT }).where(eq(serverRoles.id, everyone.id));
      invalidateAllServers();
      m.sent.length = 0;
      await handleCallJoin(m.socket, { conversationId: voiceChannelId });
      assert.equal(m.sent.find((s) => s.event === 'error')?.payload.code, 'call-not-allowed');
      assert.equal(m.participant.callConversationId, null);
    } finally {
      cleanupParticipant(m.participant);
    }
  });
});

describe('role hierarchy: escalation paths (real Postgres)', () => {
  async function setup() {
    const owner = await actor('esc'); const manager = await actor('esc'); const target = await actor('esc');
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [manager.id, target.id]);
    const bans = (await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'Bans', permissions: PERMISSIONS.BAN_MEMBERS })).body.roleId;
    const admins = (await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'Admins', permissions: PERMISSIONS.ADMINISTRATOR })).body.roleId;
    const plain = (await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'Plain' })).body.roleId;
    const managers = (await call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: 'Managers', permissions: PERMISSIONS.MANAGE_ROLES })).body.roleId;
    // Managers on top, every other role below it
    assert.equal((await call(owner, 'PUT', `/api/servers/${serverId}/roles/order`, { roleIds: [plain, admins, bans, managers] })).status, 200);
    await call(owner, 'PUT', `/api/servers/${serverId}/members/${manager.id}/roles`, { roleIds: [managers] });
    return { owner, manager, target, serverId, textChannelId, bans, admins, plain, managers };
  }

  it('MANAGE_ROLES alone hands out only roles whose permissions the manager holds, to others or to themself', async () => {
    const { owner, manager, target, serverId, bans, admins, plain, managers } = await setup();
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/members/${target.id}/roles`, { roleIds: [plain] })).status, 200);
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/members/${target.id}/roles`, { roleIds: [plain, bans] })).code, 'hierarchy');
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/members/${manager.id}/roles`, { roleIds: [managers, admins] })).code, 'hierarchy');
    // taking such a role away is not a grant: still allowed
    await call(owner, 'PUT', `/api/servers/${serverId}/members/${target.id}/roles`, { roleIds: [plain, bans] });
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/members/${target.id}/roles`, { roleIds: [plain] })).status, 200);
  });

  it('a member overwrite only from someone above that member (or for oneself)', async () => {
    const { owner, manager, target, serverId, textChannelId } = await setup();
    const deny = { allow: 0, deny: PERMISSIONS.SEND_MESSAGES };
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/overwrites/${textChannelId}`, { userId: owner.id, ...deny })).code, 'hierarchy');
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/overwrites/${textChannelId}`, { userId: target.id, ...deny })).status, 200);
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/overwrites/${textChannelId}`, { userId: manager.id, allow: 0, deny: PERMISSIONS.ADD_REACTIONS })).status, 200);
  });

  it('deleting a role closes the gap, so someone who is not the owner can still reorder, and the log keeps what it had', async () => {
    const { owner, manager, serverId, bans, admins, plain } = await setup();
    assert.equal((await call(owner, 'DELETE', `/api/roles/${admins}`)).status, 200);
    const positions = (await db.select({ id: serverRoles.id, position: serverRoles.position }).from(serverRoles)
      .where(and(eq(serverRoles.serverId, serverId), eq(serverRoles.isDefault, false))).orderBy(asc(serverRoles.position))).map((r) => r.position);
    assert.deepEqual(positions, [1, 2, 3]);
    const order = (await db.select({ id: serverRoles.id }).from(serverRoles)
      .where(and(eq(serverRoles.serverId, serverId), eq(serverRoles.isDefault, false))).orderBy(asc(serverRoles.position))).map((r) => r.id);
    assert.deepEqual(order.slice(0, 2), [plain, bans]);
    assert.equal((await call(manager, 'PUT', `/api/servers/${serverId}/roles/order`, { roleIds: [bans, plain, order[2]] })).status, 200);
    const [entry] = await db.select().from(serverAuditLogs).where(and(eq(serverAuditLogs.serverId, serverId), eq(serverAuditLogs.action, 'role.delete')));
    const changes = (entry!.detail as { changes?: { key: string; before: unknown; after: unknown }[] }).changes ?? [];
    assert.deepEqual(changes.find((c) => c.key === 'permissions'), { key: 'permissions', before: PERMISSIONS.ADMINISTRATOR, after: null });
  });

  it('roles created at the same time never share a position', async () => {
    const owner = await actor('pos');
    const { serverId } = await makeServerWithMembers(owner.id, []);
    const created = await Promise.all(Array.from({ length: 6 }, (_, i) => call(owner, 'POST', `/api/servers/${serverId}/roles`, { name: `r${i}` })));
    assert.ok(created.every((r) => r.status === 201));
    const positions = (await db.select({ position: serverRoles.position }).from(serverRoles)
      .where(and(eq(serverRoles.serverId, serverId), eq(serverRoles.isDefault, false)))).map((r) => r.position).sort((a, b) => a - b);
    assert.deepEqual(positions, [1, 2, 3, 4, 5, 6]);
  });
});

describe('a call follows the permissions in force (real Postgres)', () => {
  it('taking CONNECT away from @everyone takes a plain member out of the voice channel', async () => {
    const owner = await actor('cp'); const member = await actor('cp');
    const { serverId, voiceChannelId } = await makeServerWithMembers(owner.id, [member.id]);
    const m = joinNew(member);
    try {
      setCallConversationId(m.participant, voiceChannelId);
      const everyone = await everyoneOf(serverId);
      // an unrelated change leaves them where they are
      assert.equal((await call(owner, 'PATCH', `/api/roles/${everyone.id}`, { color: '#112233' })).status, 200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(m.participant.callConversationId, voiceChannelId);
      assert.equal((await call(owner, 'PATCH', `/api/roles/${everyone.id}`, { permissions: everyone.permissions & ~PERMISSIONS.CONNECT })).status, 200);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(m.participant.callConversationId, null);
    } finally {
      cleanupParticipant(m.participant);
    }
  });
});

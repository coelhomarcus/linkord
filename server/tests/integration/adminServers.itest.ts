import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { adminAuditLogs, messages, servers } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { makeServerWithMembers, makeUser, db, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

interface Actor { id: string; username: string; cookie: string }
async function actor(prefix: string, role: 'user' | 'admin' = 'user'): Promise<Actor> {
  const user = await makeUser(prefix, role);
  return { ...user, cookie: `${config.SESSION_COOKIE}=${(await createSession(user.id)).rawToken}` };
}

async function call(as: Actor, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: as.cookie } });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function makeWebhook(owner: Actor, channelId: string, name: string) {
  const reply = await call(owner, 'POST', `/api/channels/${channelId}/webhooks`, { name });
  assert.equal(reply.status, 201);
  return reply.body.webhook as { id: string; token: string };
}

const reason = { reason: 'vazou a URL do webhook' };

describe('admin servers and webhooks (real Postgres)', () => {
  it('lists servers by name with their counts, and a detail with members and channel names — never a message', async () => {
    const admin = await actor('as', 'admin');
    const owner = await actor('as');
    const member = await actor('as');
    const tag = `srv-${owner.id.slice(0, 6)}`;
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [member.id], `${tag} equipe`);
    await db.insert(messages).values({ conversationId: textChannelId, authorId: owner.id, text: 'segredo' });

    const list = await call(admin, 'GET', `/api/admin/servers?q=${tag}`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((s: { name: string; memberCount: number; channelCount: number }) => [s.name, s.memberCount, s.channelCount]), [[`${tag} equipe`, 2, 2]]);

    const detail = await call(admin, 'GET', `/api/admin/servers/${serverId}`);
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body.members.items.map((m: { user: { id: string } }) => m.user.id).sort(), [owner.id, member.id].sort());
    assert.equal(detail.body.channels.length, 2);
    assert.equal(JSON.stringify(detail.body).includes('segredo'), false);
  });

  it('suspends, reactivates, reassigns and deletes a server, each with its audit trail', async () => {
    const admin = await actor('as', 'admin');
    const owner = await actor('as');
    const member = await actor('as');
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [member.id], 'Ciclo');
    const webhook = await makeWebhook(owner, textChannelId, 'Ciclo');
    const url = `/api/webhooks/${webhook.id}/${webhook.token}`;

    assert.equal((await call(admin, 'POST', `/api/admin/servers/${serverId}/suspend`, reason)).status, 200);
    assert.equal((await app.inject({ method: 'POST', url, payload: { content: 'x' } })).statusCode, 401, 'a suspended server takes no posts');
    assert.equal((await call(admin, 'POST', `/api/admin/servers/${serverId}/reactivate`, reason)).status, 200);
    assert.equal((await app.inject({ method: 'POST', url, payload: { content: 'x' } })).statusCode, 201);

    assert.equal((await call(admin, 'POST', `/api/admin/servers/${serverId}/owner`, { ...reason, userId: member.id })).status, 200);
    assert.equal((await db.select({ ownerId: servers.ownerId }).from(servers).where(eq(servers.id, serverId)))[0]!.ownerId, member.id);
    assert.equal((await call(admin, 'POST', `/api/admin/servers/${serverId}/owner`, { ...reason, userId: admin.id })).status, 409, 'only a member can own it');

    assert.equal((await call(admin, 'DELETE', `/api/admin/servers/${serverId}`, reason)).status, 200);
    assert.equal((await db.select().from(servers).where(eq(servers.id, serverId))).length, 0);
    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, textChannelId))).length, 0);

    const actions = (await db.select({ action: adminAuditLogs.action }).from(adminAuditLogs).where(eq(adminAuditLogs.targetId, serverId))).map((r) => r.action).sort();
    assert.deepEqual(actions, ['server.assign_owner', 'server.delete', 'server.reactivate', 'server.suspend']);
  });

  it('revoking a webhook kills the URL at once, keeps the webhook, and is audited', async () => {
    const admin = await actor('as', 'admin');
    const owner = await actor('as');
    const { textChannelId } = await makeServerWithMembers(owner.id, [], 'Vazado');
    const webhook = await makeWebhook(owner, textChannelId, 'Monitor');
    await app.inject({ method: 'POST', url: `/api/webhooks/${webhook.id}/${webhook.token}`, payload: { content: 'ok' } });

    const list = await call(admin, 'GET', `/api/admin/webhooks?q=${webhook.id}`);
    assert.deepEqual(list.body.items.map((w: { id: string; messageCount: number }) => [w.id, w.messageCount]), [[webhook.id, 1]]);
    assert.equal(JSON.stringify(list.body).includes(webhook.token), false);

    assert.equal((await call(admin, 'POST', `/api/admin/webhooks/${webhook.id}/revoke`, reason)).status, 200);
    assert.equal((await app.inject({ method: 'POST', url: `/api/webhooks/${webhook.id}/${webhook.token}`, payload: { content: 'x' } })).statusCode, 401);
    const [entry] = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, webhook.id), eq(adminAuditLogs.action, 'webhook.revoke')));
    assert.deepEqual({ type: entry?.targetType, reason: entry?.reason }, { type: 'webhook', reason: reason.reason });
  });

  it('is for admins only', async () => {
    const user = await actor('as');
    assert.equal((await call(user, 'GET', '/api/admin/servers')).status, 403);
    assert.equal((await call(user, 'GET', '/api/admin/webhooks')).status, 403);
  });
});

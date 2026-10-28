import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { adminAuditLogs, conversationMembers, conversations, messages } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { makeGroupWithMembers, makeUser, db, pool } from './helpers.js';

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

async function makeBot(owner: Actor, title: string) {
  const reply = await call(owner, 'POST', '/api/bots', { title });
  assert.equal(reply.status, 201);
  return reply.body as { conversationId: string; webhook: { id: string; token: string } };
}

const reason = { reason: 'vazou a URL do webhook' };

describe('admin bots (real Postgres)', () => {
  it('lists bots apart from groups, with how much each one posted', async () => {
    const admin = await actor('ab', 'admin');
    const owner = await actor('ab');
    const tag = `bot-${owner.id.slice(0, 6)}`;
    const bot = await makeBot(owner, `${tag} deploys`);
    await makeGroupWithMembers(owner.id, [], `${tag} grupo`);
    await app.inject({ method: 'POST', url: `/api/webhooks/${bot.webhook.id}/${bot.webhook.token}`, payload: { content: 'ok' } });

    const list = await call(admin, 'GET', `/api/admin/bots?q=${tag}`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.items.map((b: { title: string }) => b.title), [`${tag} deploys`]);
    assert.equal(list.body.items[0].messageCount, 1);
    assert.ok(list.body.items[0].webhookLastUsedAt);
    const groups = await call(admin, 'GET', `/api/admin/groups?q=${tag}`);
    assert.deepEqual(groups.body.items.map((g: { title: string }) => g.title), [`${tag} grupo`]);
  });

  it('a bot detail shows its webhook and members, but never a token or a message', async () => {
    const admin = await actor('ab', 'admin');
    const owner = await actor('ab');
    const bot = await makeBot(owner, 'Monitor');
    const detail = await call(admin, 'GET', `/api/admin/bots/${bot.conversationId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.webhook.id, bot.webhook.id);
    assert.equal(JSON.stringify(detail.body).includes(bot.webhook.token), false);
    assert.equal(detail.body.messages, undefined);
    assert.deepEqual(detail.body.members.items.map((m: { user: { id: string } }) => m.user.id), [owner.id]);
    // a group id is not a bot
    const group = await makeGroupWithMembers(owner.id, []);
    assert.equal((await call(admin, 'GET', `/api/admin/bots/${group}`)).status, 404);
  });

  it('revoking the webhook kills the URL at once, keeps the bot, and is audited', async () => {
    const admin = await actor('ab', 'admin');
    const owner = await actor('ab');
    const bot = await makeBot(owner, 'Vazado');
    const url = `/api/webhooks/${bot.webhook.id}/${bot.webhook.token}`;

    assert.equal((await call(admin, 'POST', `/api/admin/bots/${bot.conversationId}/revoke-webhook`, reason)).status, 200);
    assert.equal((await app.inject({ method: 'POST', url, payload: { content: 'x' } })).statusCode, 401);
    assert.equal((await db.select().from(conversations).where(eq(conversations.id, bot.conversationId))).length, 1);
    const [entry] = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.targetId, bot.conversationId), eq(adminAuditLogs.action, 'bot.revoke_webhook')));
    assert.deepEqual({ type: entry?.targetType, reason: entry?.reason }, { type: 'bot', reason: reason.reason });

    // the owner gets it back by generating a new one
    const rotated = await call(owner, 'POST', `/api/bots/${bot.conversationId}/webhook/rotate`);
    assert.equal((await app.inject({ method: 'POST', url: `/api/webhooks/${bot.webhook.id}/${rotated.body.webhook.token}`, payload: { content: 'x' } })).statusCode, 201);
  });

  it('suspends, reactivates and deletes a bot with its own audit trail, and never a group by its bot route', async () => {
    const admin = await actor('ab', 'admin');
    const owner = await actor('ab');
    const bot = await makeBot(owner, 'Ciclo');
    const url = `/api/webhooks/${bot.webhook.id}/${bot.webhook.token}`;

    assert.equal((await call(admin, 'POST', `/api/admin/bots/${bot.conversationId}/suspend`, reason)).status, 200);
    assert.equal((await app.inject({ method: 'POST', url, payload: { content: 'x' } })).statusCode, 401);
    assert.equal((await call(admin, 'POST', `/api/admin/bots/${bot.conversationId}/reactivate`, reason)).status, 200);
    assert.equal((await app.inject({ method: 'POST', url, payload: { content: 'x' } })).statusCode, 201);

    const actions = (await db.select({ action: adminAuditLogs.action }).from(adminAuditLogs).where(eq(adminAuditLogs.targetId, bot.conversationId))).map((r) => r.action).sort();
    assert.deepEqual(actions, ['bot.reactivate', 'bot.suspend']);

    const group = await makeGroupWithMembers(owner.id, []);
    assert.equal((await call(admin, 'POST', `/api/admin/bots/${group}/suspend`, reason)).status, 404);
    assert.equal((await call(admin, 'POST', `/api/admin/groups/${bot.conversationId}/suspend`, reason)).status, 404);

    assert.equal((await call(admin, 'DELETE', `/api/admin/bots/${bot.conversationId}`, reason)).status, 200);
    assert.equal((await db.select().from(conversations).where(eq(conversations.id, bot.conversationId))).length, 0);
    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, bot.conversationId))).length, 0);
  });

  it('assigns a new owner among its members', async () => {
    const admin = await actor('ab', 'admin');
    const owner = await actor('ab');
    const member = await actor('ab');
    const bot = await makeBot(owner, 'Herança');
    await db.insert(conversationMembers).values({ conversationId: bot.conversationId, userId: member.id, role: 'member' });
    assert.equal((await call(admin, 'POST', `/api/admin/bots/${bot.conversationId}/owner`, { ...reason, userId: member.id })).status, 200);
    assert.equal((await call(member, 'GET', `/api/bots/${bot.conversationId}/webhook`)).status, 200);
    assert.equal((await call(owner, 'GET', `/api/bots/${bot.conversationId}/webhook`)).status, 404);
  });

  it('is for admins only', async () => {
    const user = await actor('ab');
    assert.equal((await call(user, 'GET', '/api/admin/bots')).status, 403);
  });
});

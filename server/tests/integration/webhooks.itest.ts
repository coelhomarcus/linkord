import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { channelPermissionOverwrites, conversations, messages, serverRoles, webhooks } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { handlers as chatHandlers } from '../../src/modules/messages/messages.js';
import { hashWebhookToken } from '../../src/modules/bots/webhooksRepository.js';
import { PERMISSIONS } from '../../src/modules/servers/permissions.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

interface Actor { id: string; username: string; token: string }
async function actor(prefix: string): Promise<Actor> {
  const user = await makeUser(prefix);
  return { ...user, token: (await createSession(user.id)).rawToken };
}

async function call(as: Actor, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown): Promise<{ status: number; code?: string; body: any }> {
  const res = await app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: `${config.SESSION_COOKIE}=${as.token}` } });
  const body = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, code: body?.error?.code, body };
}

/** A server whose first text channel has a webhook, and a plain member. */
async function channelWithWebhook() {
  const owner = await actor('wo');
  const member = await actor('wm');
  const server = await makeServerWithMembers(owner.id, [member.id]);
  const created = await call(owner, 'POST', `/api/channels/${server.textChannelId}/webhooks`, { name: 'Deploys' });
  assert.equal(created.status, 201);
  return { owner, member, ...server, webhook: created.body.webhook as { id: string; token: string; url: string } };
}

describe('channel webhooks (real Postgres)', () => {
  it('creating one keeps only the token hash and shows the URL once', async () => {
    const { webhook, textChannelId } = await channelWithWebhook();
    const [stored] = await db.select().from(webhooks).where(eq(webhooks.id, webhook.id));
    assert.deepEqual({ channel: stored?.conversationId, name: stored?.name }, { channel: textChannelId, name: 'Deploys' });
    assert.equal(stored?.tokenHash, hashWebhookToken(webhook.token));
    assert.match(webhook.url, new RegExp(`/api/webhooks/${webhook.id}/${webhook.token}$`));
  });

  it('only MANAGE_WEBHOOKS sees and manages them; a plain member gets the same 404 as a stranger', async () => {
    const { owner, member, textChannelId, webhook } = await channelWithWebhook();
    const list = await call(owner, 'GET', `/api/channels/${textChannelId}/webhooks`);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.webhooks.map((w: { id: string; token?: string }) => [w.id, w.token]), [[webhook.id, undefined]]);
    for (const [method, url] of [
      ['GET', `/api/channels/${textChannelId}/webhooks`],
      ['POST', `/api/channels/${textChannelId}/webhooks/${webhook.id}/rotate`],
      ['DELETE', `/api/channels/${textChannelId}/webhooks/${webhook.id}`],
    ] as const) {
      assert.equal((await call(member, method, url)).status, 404, `${method} ${url}`);
    }
  });

  it('rotating replaces the token under the same id; renaming changes the name on its whole history', async () => {
    const { owner, member, textChannelId, webhook } = await channelWithWebhook();
    await app.inject({ method: 'POST', url: `/api/webhooks/${webhook.id}/${webhook.token}`, payload: { content: 'first' } });
    const rotated = await call(owner, 'POST', `/api/channels/${textChannelId}/webhooks/${webhook.id}/rotate`);
    assert.equal(rotated.body.webhook.id, webhook.id);
    assert.notEqual(rotated.body.webhook.token, webhook.token);
    assert.equal((await app.inject({ method: 'POST', url: `/api/webhooks/${webhook.id}/${webhook.token}`, payload: { content: 'x' } })).statusCode, 401);

    assert.equal((await call(owner, 'PATCH', `/api/channels/${textChannelId}/webhooks/${webhook.id}`, { name: 'CI' })).status, 200);
    const { socket, sent, participant } = joinNew(member);
    try {
      await chatHandlers['conversation-open']!(socket, { conversationId: textChannelId });
      const history = sent.find((s) => s.event === 'conversation-history')?.payload.messages;
      assert.deepEqual(history.map((m: { name: string; bot?: boolean }) => [m.name, m.bot]), [['CI', true]]);
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('a read-only channel: people cannot post or upload, the webhook still can', async () => {
    const { member, serverId, textChannelId, webhook } = await channelWithWebhook();
    const [everyone] = await db.select().from(serverRoles).where(eq(serverRoles.serverId, serverId));
    await db.update(conversations).set({ permissionsSynced: false }).where(eq(conversations.id, textChannelId));
    await db.insert(channelPermissionOverwrites).values({ id: crypto.randomUUID(), serverId, channelId: textChannelId, roleId: everyone!.id, deny: PERMISSIONS.SEND_MESSAGES });
    invalidateAllServers();
    const { socket, sent, participant } = joinNew(member);
    try {
      await chatHandlers.chat!(socket, { conversationId: textChannelId, text: 'hi', clientMessageId: crypto.randomUUID() });
      assert.equal(sent.find((s) => s.event === 'chat-send-result')?.payload.error?.code, 'forbidden');
      const upload = await call(member, 'POST', '/api/attachments/init', { conversationId: textChannelId, fileName: 'a.txt', mimeType: 'text/plain', totalSize: 10 });
      assert.deepEqual({ status: upload.status, code: upload.code }, { status: 403, code: 'forbidden' });
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal((await app.inject({ method: 'POST', url: `/api/webhooks/${webhook.id}/${webhook.token}`, payload: { content: 'deploy ok' } })).statusCode, 201);
  });

  it('MANAGE_MESSAGES deletes what a webhook posted; a plain member does not', async () => {
    const { owner, member, textChannelId, webhook } = await channelWithWebhook();
    const [row] = await db.insert(messages).values({ conversationId: textChannelId, authorId: null, webhookId: webhook.id, text: 'deploy ok' }).returning({ id: messages.id });
    const ownerSocket = joinNew(owner);
    const memberSocket = joinNew(member);
    try {
      await chatHandlers['chat-delete']!(memberSocket.socket, { msgId: row!.id, requestId: 'm' });
      assert.equal(memberSocket.sent.find((s) => s.event === 'chat-action-result')?.payload.error?.code, 'forbidden');
      await chatHandlers['chat-delete']!(ownerSocket.socket, { msgId: row!.id, requestId: 'o' });
      assert.equal(ownerSocket.sent.find((s) => s.event === 'chat-action-result')?.payload.error, undefined);
      assert.equal((await db.select().from(messages).where(eq(messages.id, row!.id))).length, 0);
    } finally {
      cleanupParticipant(ownerSocket.participant);
      cleanupParticipant(memberSocket.participant);
    }
  });

  it('deleting a webhook keeps its messages, as an unnamed bot; a voice channel has none', async () => {
    const { owner, textChannelId, voiceChannelId, webhook } = await channelWithWebhook();
    await app.inject({ method: 'POST', url: `/api/webhooks/${webhook.id}/${webhook.token}`, payload: { content: 'stays' } });
    assert.equal((await call(owner, 'DELETE', `/api/channels/${textChannelId}/webhooks/${webhook.id}`)).status, 200);
    const rows = await db.select().from(messages).where(eq(messages.conversationId, textChannelId));
    assert.deepEqual(rows.map((r) => [r.text, r.webhookId]), [['stays', null]]);
    assert.equal((await call(owner, 'POST', `/api/channels/${voiceChannelId}/webhooks`, { name: 'x' })).status, 404);
  });

  it('stops at the per-channel limit', async () => {
    const original = config.MAX_WEBHOOKS_PER_CHANNEL;
    config.MAX_WEBHOOKS_PER_CHANNEL = 2;
    try {
      const { owner, textChannelId } = await channelWithWebhook();
      assert.equal((await call(owner, 'POST', `/api/channels/${textChannelId}/webhooks`, { name: 'two' })).status, 201);
      const blocked = await call(owner, 'POST', `/api/channels/${textChannelId}/webhooks`, { name: 'three' });
      assert.deepEqual({ status: blocked.status, code: blocked.code }, { status: 409, code: 'quota_exceeded' });
    } finally {
      config.MAX_WEBHOOKS_PER_CHANNEL = original;
    }
  });
});

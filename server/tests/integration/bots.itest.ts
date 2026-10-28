import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { conversationMembers, conversations, messages, webhooks } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { handlers as chatHandlers } from '../../src/modules/messages/messages.js';
import { handlers as conversationHandlers } from '../../src/modules/conversations/conversations.js';
import { createGroup, listForUser } from '../../src/modules/conversations/conversationsRepository.js';
import { hashWebhookToken } from '../../src/modules/bots/webhooksRepository.js';
import { befriend, cleanupParticipant, db, joinNew, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

interface Actor { id: string; username: string; token: string }
async function actor(prefix: string): Promise<Actor> {
  const user = await makeUser(prefix);
  return { ...user, token: (await createSession(user.id)).rawToken };
}

async function call(as: Actor, method: 'GET' | 'POST', url: string, payload?: unknown): Promise<{ status: number; code?: string; body: any }> {
  const res = await app.inject({ method, url, payload: payload as object | undefined, headers: { cookie: `${config.SESSION_COOKIE}=${as.token}` } });
  const body = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, code: body?.error?.code, body };
}

async function createBot(owner: Actor, title = 'Deploys'): Promise<{ conversationId: string; webhook: { id: string; token: string } }> {
  const reply = await call(owner, 'POST', '/api/bots', { title });
  assert.equal(reply.status, 201);
  return reply.body;
}

/** A bot with `member` already in it, the way an accepted invitation leaves it. */
async function botWithMember() {
  const owner = await actor('bo');
  const member = await actor('bm');
  const bot = await createBot(owner);
  await db.insert(conversationMembers).values({ conversationId: bot.conversationId, userId: member.id, role: 'member' });
  return { owner, member, ...bot };
}

async function postAsWebhook(conversationId: string, webhookId: string): Promise<number> {
  const [row] = await db.insert(messages).values({ conversationId, authorId: null, webhookId, text: 'deploy ok' }).returning({ id: messages.id });
  return row!.id;
}

describe('bots (real Postgres)', () => {
  it('creating a bot makes a bot conversation owned by its creator, with a webhook whose token is only kept hashed', async () => {
    const owner = await actor('bo');
    const { conversationId, webhook } = await createBot(owner);

    const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId));
    assert.equal(conversation?.type, 'bot');
    const [stored] = await db.select().from(webhooks).where(eq(webhooks.id, webhook.id));
    assert.equal(stored?.conversationId, conversationId);
    assert.notEqual(stored?.tokenHash, webhook.token);
    assert.equal(stored?.tokenHash, hashWebhookToken(webhook.token));

    const listed = (await listForUser(owner.id)).find((c) => c.id === conversationId);
    assert.deepEqual({ type: listed?.type, myRole: listed?.myRole }, { type: 'bot', myRole: 'owner' });
  });

  it('only the owner sees the webhook, and rotating replaces the token under the same id', async () => {
    const { owner, member, conversationId, webhook } = await botWithMember();

    const info = await call(owner, 'GET', `/api/bots/${conversationId}/webhook`);
    assert.equal(info.status, 200);
    assert.equal(info.body.webhook.id, webhook.id);
    assert.equal(info.body.webhook.token, undefined);
    assert.equal((await call(member, 'GET', `/api/bots/${conversationId}/webhook`)).status, 404);
    assert.equal((await call(member, 'POST', `/api/bots/${conversationId}/webhook/rotate`)).status, 404);

    const rotated = await call(owner, 'POST', `/api/bots/${conversationId}/webhook/rotate`);
    assert.equal(rotated.status, 200);
    assert.equal(rotated.body.webhook.id, webhook.id);
    assert.notEqual(rotated.body.webhook.token, webhook.token);
    const [stored] = await db.select().from(webhooks).where(eq(webhooks.id, webhook.id));
    assert.equal(stored?.tokenHash, hashWebhookToken(rotated.body.webhook.token));
  });

  it('a group is not a bot: its owner gets no webhook', async () => {
    const owner = await actor('bo');
    const group = await createGroup(owner.id, 'not a bot');
    assert.equal((await call(owner, 'GET', `/api/bots/${group.id}/webhook`)).status, 404);
    assert.equal((await call(owner, 'POST', `/api/bots/${group.id}/webhook/rotate`)).status, 404);
  });

  it('no human posts, types or uploads in a bot — not even its owner', async () => {
    const { owner, member, conversationId } = await botWithMember();
    const ownerSocket = joinNew(owner);
    const memberSocket = joinNew(member);
    try {
      for (const { socket, sent } of [ownerSocket, memberSocket]) {
        await chatHandlers.chat!(socket, { conversationId, text: 'hi', requestId: 'r1', clientMessageId: crypto.randomUUID() });
        const result = sent.find((s) => s.event === 'chat-send-result')?.payload;
        assert.equal(result?.error?.code, 'forbidden');
      }
      await chatHandlers.typing!(memberSocket.socket, { conversationId, value: true });
      assert.equal(ownerSocket.sent.some((s) => s.event === 'typing'), false);
      assert.equal((await db.select().from(messages).where(eq(messages.conversationId, conversationId))).length, 0);

      const upload = await call(owner, 'POST', '/api/attachments/init', { conversationId, fileName: 'a.txt', mimeType: 'text/plain', totalSize: 10 });
      assert.deepEqual({ status: upload.status, code: upload.code }, { status: 403, code: 'forbidden' });
    } finally {
      cleanupParticipant(ownerSocket.participant);
      cleanupParticipant(memberSocket.participant);
    }
  });

  it("the bot's owner deletes what it posted; a member does not", async () => {
    const { owner, member, conversationId, webhook } = await botWithMember();
    const msgId = await postAsWebhook(conversationId, webhook.id);
    const ownerSocket = joinNew(owner);
    const memberSocket = joinNew(member);
    try {
      await chatHandlers['chat-delete']!(memberSocket.socket, { msgId, requestId: 'm' });
      assert.equal(memberSocket.sent.find((s) => s.event === 'chat-action-result')?.payload.error?.code, 'forbidden');
      assert.equal((await db.select().from(messages).where(eq(messages.id, msgId))).length, 1);

      await chatHandlers['chat-delete']!(ownerSocket.socket, { msgId, requestId: 'o' });
      assert.equal(ownerSocket.sent.find((s) => s.event === 'chat-action-result')?.payload.error, undefined);
      assert.equal((await db.select().from(messages).where(eq(messages.id, msgId))).length, 0);
    } finally {
      cleanupParticipant(ownerSocket.participant);
      cleanupParticipant(memberSocket.participant);
    }
  });

  it('friends join a bot through the group invitation, and its card says it is a bot', async () => {
    const owner = await actor('bo');
    const friend = await actor('bf');
    await befriend(owner.id, friend.id);
    const { conversationId } = await createBot(owner);

    const invited = await call(owner, 'POST', `/api/groups/${conversationId}/invitations`, { userIds: [friend.id] });
    assert.equal(invited.body.results[0].outcome, 'sent');
    const received = await call(friend, 'GET', '/api/group-invitations');
    assert.equal(received.body.items[0].group.type, 'bot');

    const accepted = await call(friend, 'POST', `/api/group-invitations/${invited.body.results[0].invitationId}/accept`);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.invitation.groupType, 'bot');
    const [membership] = await db.select().from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, friend.id)));
    assert.equal(membership?.role, 'member');
  });

  it("the owner deletes the bot, its webhook going with it", async () => {
    const { owner, conversationId, webhook } = await botWithMember();
    const { socket, participant } = joinNew(owner);
    try {
      await conversationHandlers['group-delete']!(socket, { conversationId });
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal((await db.select().from(conversations).where(eq(conversations.id, conversationId))).length, 0);
    assert.equal((await db.select().from(webhooks).where(eq(webhooks.id, webhook.id))).length, 0);
  });

  it('stops at the bot quota, separate from the group one', async () => {
    const owner = await actor('bo');
    for (let i = 0; i < config.MAX_OWNED_BOTS_PER_USER; i++) await createGroup(owner.id, `bot ${i}`, 'bot');
    const blocked = await call(owner, 'POST', '/api/bots', { title: 'one too many' });
    assert.deepEqual({ status: blocked.status, code: blocked.code }, { status: 409, code: 'quota_exceeded' });
    assert.equal((await call(owner, 'POST', '/api/groups', { title: 'still fine' })).status, 201);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { conversationMembers, conversations, messages, webhooks } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { handlers as chatHandlers } from '../../src/modules/messages/messages.js';
import { unreadCountsForUser } from '../../src/modules/conversations/conversationsRepository.js';
import { cleanupParticipant, db, joinNew, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

interface Bot { conversationId: string; owner: { id: string; username: string }; webhook: { id: string; token: string; url: string } }

async function makeBot(title = 'Deploys'): Promise<Bot> {
  const owner = await makeUser('wo');
  const token = (await createSession(owner.id)).rawToken;
  const res = await app.inject({ method: 'POST', url: '/api/bots', payload: { title }, headers: { cookie: `${config.SESSION_COOKIE}=${token}` } });
  assert.equal(res.statusCode, 201);
  return { owner, ...JSON.parse(res.body) };
}

async function post(url: string, payload: unknown, headers: Record<string, string> = {}) {
  const res = await app.inject({ method: 'POST', url, payload: payload as object, headers });
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null };
}

const pathOf = (bot: Bot) => `/api/webhooks/${bot.webhook.id}/${bot.webhook.token}`;
const rowsOf = (conversationId: string) => db.select().from(messages).where(eq(messages.conversationId, conversationId));

describe('webhook ingress (real Postgres)', () => {
  it('a post becomes a message from the bot, live for its members and with its name and photo', async () => {
    const bot = await makeBot('Deploys');
    await db.update(conversations).set({ avatar: '/uploads/bot.png' }).where(eq(conversations.id, bot.conversationId));
    assert.match(bot.webhook.url, new RegExp(`/api/webhooks/${bot.webhook.id}/${bot.webhook.token}$`));
    const { socket, sent, participant } = joinNew(bot.owner);
    try {
      const reply = await post(pathOf(bot), { content: '  deploy ok  ' });
      assert.equal(reply.status, 201);
      assert.equal(reply.body.duplicate, false);

      const [row] = await rowsOf(bot.conversationId);
      assert.deepEqual({ text: row?.text, authorId: row?.authorId, webhookId: row?.webhookId }, { text: 'deploy ok', authorId: null, webhookId: bot.webhook.id });
      const live = sent.find((s) => s.event === 'chat')?.payload.message;
      assert.deepEqual({ msgId: live.msgId, id: live.id, name: live.name, avatar: live.avatar, bot: live.bot }, { msgId: reply.body.id, id: null, name: 'Deploys', avatar: '/uploads/bot.png', bot: true });

      const [stored] = await db.select().from(webhooks).where(eq(webhooks.id, bot.webhook.id));
      assert.ok(stored?.lastUsedAt);

      // history reads the bot's current name, so a rename shows on old messages too
      await db.update(conversations).set({ title: 'CI' }).where(eq(conversations.id, bot.conversationId));
      await chatHandlers['conversation-open']!(socket, { conversationId: bot.conversationId });
      const history = sent.find((s) => s.event === 'conversation-history')?.payload.messages;
      assert.deepEqual(history.map((m: { name: string; bot?: boolean }) => [m.name, m.bot]), [['CI', true]]);
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('takes the token as a Bearer header too', async () => {
    const bot = await makeBot();
    const reply = await post(`/api/webhooks/${bot.webhook.id}`, { content: 'via header' }, { authorization: `Bearer ${bot.webhook.token}` });
    assert.equal(reply.status, 201);
    assert.equal((await rowsOf(bot.conversationId)).length, 1);
  });

  it('a wrong token, an unknown id, a rotated-out token and a suspended bot all get the same answer', async () => {
    const bot = await makeBot();
    const other = await makeBot();
    const attempts = [
      `/api/webhooks/${bot.webhook.id}/${other.webhook.token}`,
      `/api/webhooks/does-not-exist/${bot.webhook.token}`,
    ];
    for (const url of attempts) {
      const reply = await post(url, { content: 'x' });
      assert.deepEqual({ status: reply.status, code: reply.body.error.code }, { status: 401, code: 'invalid_webhook' }, url);
    }
    assert.equal((await post(`/api/webhooks/${bot.webhook.id}`, { content: 'x' })).status, 401);

    const ownerToken = (await createSession(bot.owner.id)).rawToken;
    await app.inject({ method: 'POST', url: `/api/bots/${bot.conversationId}/webhook/rotate`, headers: { cookie: `${config.SESSION_COOKIE}=${ownerToken}` } });
    assert.equal((await post(pathOf(bot), { content: 'x' })).status, 401);

    await db.update(conversations).set({ status: 'suspended' }).where(eq(conversations.id, other.conversationId));
    assert.equal((await post(pathOf(other), { content: 'x' })).status, 401);
    assert.equal((await rowsOf(bot.conversationId)).length + (await rowsOf(other.conversationId)).length, 0);
  });

  it('the same Idempotency-Key posts once and answers the retry with the first message', async () => {
    const bot = await makeBot();
    const first = await post(pathOf(bot), { content: 'once' }, { 'idempotency-key': 'build-42' });
    const retry = await post(pathOf(bot), { content: 'once' }, { 'idempotency-key': 'build-42' });
    assert.deepEqual([first.status, retry.status], [201, 200]);
    assert.equal(retry.body.id, first.body.id);
    assert.equal(retry.body.duplicate, true);
    assert.equal((await post(pathOf(bot), { content: 'next' }, { 'idempotency-key': 'build-43' })).status, 201);
    assert.equal((await rowsOf(bot.conversationId)).length, 2);

    const badKey = await post(pathOf(bot), { content: 'x' }, { 'idempotency-key': 'x'.repeat(129) });
    assert.deepEqual({ status: badKey.status, code: badKey.body.error.code }, { status: 400, code: 'invalid_request' });
  });

  it('refuses an empty or oversized message instead of cutting it', async () => {
    const bot = await makeBot();
    for (const [payload, code] of [[{ content: '   ' }, 'invalid_message'], [{ text: 'wrong field' }, 'invalid_message'], [{ content: 'x'.repeat(config.MAX_CHAT_LEN + 1) }, 'message_too_long']] as const) {
      const reply = await post(pathOf(bot), payload);
      assert.deepEqual({ status: reply.status, code: reply.body.error.code }, { status: 400, code });
    }
    assert.equal((await rowsOf(bot.conversationId)).length, 0);
  });

  it("caps each webhook's rate, and says when to try again", async () => {
    const bot = await makeBot();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await post(pathOf(bot), { content: `n${i}` })).status);
    assert.deepEqual([statuses.filter((s) => s === 201).length, statuses.at(-1)], [30, 429]);
    const limited = await post(pathOf(bot), { content: 'more' });
    assert.ok(Number(limited.headers['retry-after']) >= 1);
  });

  it("a member who isn't the owner sees the bot's messages and reads them as unread", async () => {
    const bot = await makeBot();
    const member = await makeUser('wm');
    await db.insert(conversationMembers).values({ conversationId: bot.conversationId, userId: member.id, role: 'member', joinedAt: new Date(Date.now() - 60_000) });
    const { sent, participant } = joinNew(member);
    try {
      await post(pathOf(bot), { content: 'alert' });
      assert.equal(sent.filter((s) => s.event === 'chat').length, 1);
    } finally {
      cleanupParticipant(participant);
    }
    assert.deepEqual(await unreadCountsForUser(member.id, [bot.conversationId]), { [bot.conversationId]: 1 });
  });
});

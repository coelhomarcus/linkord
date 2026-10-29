import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { messages, notifications, userBlocks } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { handlers } from '../../src/modules/messages/messages.js';
import { listNotifications } from '../../src/modules/notifications/notificationsRepository.js';
import { getOrCreateDirect } from '../../src/modules/conversations/conversationsRepository.js';
import { befriend, cleanupParticipant, db, joinNew, makeGroupWithMembers, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

// notifyMentions runs after the send is answered; give it a moment to land
const settle = () => new Promise((r) => setTimeout(r, 150));

async function mentionsOf(userId: string) {
  return db.select().from(notifications).where(and(eq(notifications.recipientId, userId), eq(notifications.kind, 'mention')));
}

async function send(socket: Parameters<NonNullable<typeof handlers.chat>>[0], conversationId: string, text: string) {
  await handlers.chat!(socket, { conversationId, text, requestId: 'r', clientMessageId: crypto.randomUUID() });
  await settle();
}

describe('mention notifications (real Postgres)', () => {
  it('a member named in a group is notified; the author, a non-member and an unnamed member are not', async () => {
    const author = await makeUser('mn');
    const named = await makeUser('mn');
    const quiet = await makeUser('mn');
    const outsider = await makeUser('mn');
    const groupId = await makeGroupWithMembers(author.id, [named.id, quiet.id]);
    const { socket, participant } = joinNew(author);
    try {
      await send(socket, groupId, `olha isso @${named.username.toUpperCase()} e @${author.username} e @${outsider.username}`);
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal((await mentionsOf(named.id)).length, 1);
    assert.equal((await mentionsOf(author.id)).length, 0);
    assert.equal((await mentionsOf(quiet.id)).length, 0);
    assert.equal((await mentionsOf(outsider.id)).length, 0);
  });

  it('works in a direct conversation too, and lists who, where and what was said', async () => {
    const author = await makeUser('mn');
    const friend = await makeUser('mn');
    await befriend(author.id, friend.id);
    const { conversation } = await getOrCreateDirect(author.id, friend.id, author.id);
    const { socket, participant } = joinNew(author);
    try {
      await send(socket, conversation.id, `@${friend.username} viu o deploy?`);
    } finally {
      cleanupParticipant(participant);
    }
    const page = await listNotifications(friend.id);
    assert.ok(typeof page === 'object');
    const [entry] = page.items;
    assert.equal(entry?.kind, 'mention');
    assert.equal(entry?.actor?.id, author.id);
    assert.deepEqual({ type: entry?.mention?.conversation.type, id: entry?.mention?.conversation.id }, { type: 'direct', id: conversation.id });
    assert.equal(entry?.mention?.excerpt, `@${friend.username} viu o deploy?`);
  });

  it('an edit that adds a name notifies it, without notifying the ones already named twice', async () => {
    const author = await makeUser('mn');
    const first = await makeUser('mn');
    const later = await makeUser('mn');
    const groupId = await makeGroupWithMembers(author.id, [first.id, later.id]);
    const { socket, sent, participant } = joinNew(author);
    try {
      await send(socket, groupId, `oi @${first.username}`);
      const msgId = sent.find((s) => s.event === 'chat-send-result')!.payload.message.msgId;
      await handlers['chat-edit']!(socket, { msgId, text: `oi @${first.username} e @${later.username}`, requestId: 'e' });
      await settle();
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal((await mentionsOf(first.id)).length, 1);
    assert.equal((await mentionsOf(later.id)).length, 1);
  });

  it('a block either way stops the notification', async () => {
    const author = await makeUser('mn');
    const blocker = await makeUser('mn');
    const groupId = await makeGroupWithMembers(author.id, [blocker.id]);
    await db.insert(userBlocks).values({ blockerId: blocker.id, blockedId: author.id });
    const { socket, participant } = joinNew(author);
    try {
      await send(socket, groupId, `@${blocker.username} oi`);
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal((await mentionsOf(blocker.id)).length, 0);
  });

  it('opening the conversation reads its mentions, and deleting the message removes the notification', async () => {
    const author = await makeUser('mn');
    const named = await makeUser('mn');
    const groupId = await makeGroupWithMembers(author.id, [named.id]);
    const authorSocket = joinNew(author);
    const namedSocket = joinNew(named);
    try {
      await send(authorSocket.socket, groupId, `@${named.username} primeira`);
      await send(authorSocket.socket, groupId, `@${named.username} segunda`);
      assert.deepEqual((await mentionsOf(named.id)).map((n) => n.readAt), [null, null]);
      // the open bell in every tab refetches on this hint
      assert.ok(namedSocket.sent.some((s) => s.event === 'social-changed'));

      await handlers['conversation-open']!(namedSocket.socket, { conversationId: groupId });
      assert.ok((await mentionsOf(named.id)).every((n) => n.readAt !== null));

      const [last] = await db.select({ id: messages.id }).from(messages).where(eq(messages.conversationId, groupId)).orderBy(messages.id);
      await handlers['chat-delete']!(authorSocket.socket, { msgId: last!.id, requestId: 'd' });
      assert.equal((await mentionsOf(named.id)).length, 1);
    } finally {
      cleanupParticipant(authorSocket.participant);
      cleanupParticipant(namedSocket.participant);
    }
  });

  it("a bot's message notifies whoever it names, with no account as the author", async () => {
    const owner = await makeUser('mn');
    const cookie = `${config.SESSION_COOKIE}=${(await createSession(owner.id)).rawToken}`;
    const created = await app.inject({ method: 'POST', url: '/api/bots', payload: { title: 'Alertas' }, headers: { cookie } });
    const { webhook, conversationId } = JSON.parse(created.body);
    await app.inject({ method: 'POST', url: `/api/webhooks/${webhook.id}/${webhook.token}`, payload: { content: `@${owner.username} CPU alta` } });
    await settle();
    const page = await listNotifications(owner.id);
    assert.ok(typeof page === 'object');
    const [entry] = page.items;
    assert.equal(entry?.kind, 'mention');
    assert.equal(entry?.actor, null);
    assert.deepEqual({ type: entry?.mention?.conversation.type, title: entry?.mention?.conversation.title, id: entry?.mention?.conversation.id }, { type: 'bot', title: 'Alertas', id: conversationId });
  });
});

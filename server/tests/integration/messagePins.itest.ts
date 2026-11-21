import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { conversations, messages, serverAuditLogs, serverRoles } from '../../src/db/schema.js';
import { handlers as messageHandlers } from '../../src/modules/messages/messages.js';
import { conversationsWithUnseenPins, handlers, MAX_PINS_PER_CONVERSATION } from '../../src/modules/messages/pins.js';
import { getOrCreateDirect } from '../../src/modules/conversations/conversationsRepository.js';
import { PERMISSIONS } from '../../src/modules/servers/permissions.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { befriend, cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

type Sent = { event: string; payload: any }[];
const resultOf = (sent: Sent, requestId: string) => sent.find((s) => s.event === 'chat-action-result' && s.payload.requestId === requestId)?.payload;
const events = (sent: Sent, name: string) => sent.filter((s) => s.event === name).map((s) => s.payload);

async function message(conversationId: string, authorId: string, text = 'importante'): Promise<number> {
  const [row] = await db.insert(messages).values({ conversationId, authorId, text }).returning({ id: messages.id });
  return row!.id;
}

async function inServer<T>(fn: (ctx: { owner: { id: string; username: string }; member: { id: string; username: string }; serverId: string; channelId: string }) => Promise<T>): Promise<T> {
  const owner = await makeUser('pin'); const member = await makeUser('pm');
  const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [member.id]);
  return fn({ owner, member, serverId, channelId: textChannelId });
}

describe('pinning messages (real Postgres)', () => {
  it('pins for everyone: flags the message, posts a notice that only points at it, tells the channel, and audits it', () => inServer(async ({ owner, member, serverId, channelId }) => {
    const msgId = await message(channelId, member.id);
    const { socket, sent, participant } = joinNew(owner);
    try {
      await handlers['message-pin']!(socket, { msgId, pinned: true, requestId: 'r1' });
    } finally {
      cleanupParticipant(participant);
    }
    assert.deepEqual(resultOf(sent, 'r1'), { t: 'chat-action-result', requestId: 'r1' });
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.ok(row!.pinnedAt);
    assert.equal(row!.pinnedBy, owner.id);
    assert.equal(events(sent, 'chat-edited')[0].message.pinned, true);
    const notice = events(sent, 'chat').map((p) => p.message).find((m) => m.kind === 'pin_notice');
    assert.equal(notice.pinnedMessageId, msgId);
    assert.equal(notice.text, '');
    const updated = events(sent, 'conversation-pins-updated')[0];
    assert.deepEqual({ conversationId: updated.conversationId, pinned: updated.pinned, by: updated.by }, { conversationId: channelId, pinned: true, by: owner.id });
    const audit = await db.select().from(serverAuditLogs).where(and(eq(serverAuditLogs.serverId, serverId), eq(serverAuditLogs.action, 'message.pin')));
    assert.equal(audit.length, 1);
  }));

  it('refuses a member without PIN_MESSAGES, even one who may manage messages', () => inServer(async ({ member, serverId, channelId }) => {
    await db.update(serverRoles).set({ permissions: PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.MANAGE_MESSAGES }).where(eq(serverRoles.serverId, serverId));
    invalidateAllServers();
    const msgId = await message(channelId, member.id);
    const { socket, sent, participant } = joinNew(member);
    try {
      await handlers['message-pin']!(socket, { msgId, pinned: true, requestId: 'r1' });
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal(resultOf(sent, 'r1').error.code, 'forbidden');
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.equal(row!.pinnedAt, null);
  }));

  it('a repeat changes nothing, and an unpin posts no notice', () => inServer(async ({ owner, channelId }) => {
    const msgId = await message(channelId, owner.id);
    const { socket, sent, participant } = joinNew(owner);
    try {
      await handlers['message-pin']!(socket, { msgId, pinned: true, requestId: 'r1' });
      await handlers['message-pin']!(socket, { msgId, pinned: true, requestId: 'r2' });
      assert.equal(resultOf(sent, 'r2').error, undefined);
      assert.equal(events(sent, 'chat').length, 1);
      await handlers['message-pin']!(socket, { msgId, pinned: false, requestId: 'r3' });
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal(events(sent, 'chat').length, 1);
    assert.equal(events(sent, 'conversation-pins-updated').at(-1).pinned, false);
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.equal(row!.pinnedAt, null);
  }));

  it('only a message can be pinned, not a notice', () => inServer(async ({ owner, channelId }) => {
    const msgId = await message(channelId, owner.id);
    const { socket, sent, participant } = joinNew(owner);
    try {
      await handlers['message-pin']!(socket, { msgId, pinned: true, requestId: 'r1' });
      const notice = events(sent, 'chat')[0].message.msgId;
      await handlers['message-pin']!(socket, { msgId: notice, pinned: true, requestId: 'r2' });
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal(resultOf(sent, 'r2').error.code, 'forbidden');
  }));

  it('stops at the limit', () => inServer(async ({ owner, channelId }) => {
    const now = new Date();
    await db.insert(messages).values(Array.from({ length: MAX_PINS_PER_CONVERSATION }, (_, i) => ({ conversationId: channelId, authorId: owner.id, text: `p${i}`, pinnedAt: now })));
    const msgId = await message(channelId, owner.id);
    const { socket, sent, participant } = joinNew(owner);
    try {
      await handlers['message-pin']!(socket, { msgId, pinned: true, requestId: 'r1' });
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal(resultOf(sent, 'r1').error.code, 'pins_full');
  }));

  it('lists newest pin first, a page at a time', () => inServer(async ({ owner, channelId }) => {
    const ids: number[] = [];
    for (let i = 0; i < 27; i++) {
      const [row] = await db.insert(messages).values({ conversationId: channelId, authorId: owner.id, text: `p${i}`, pinnedAt: new Date(Date.UTC(2026, 0, 1, 0, i)) }).returning({ id: messages.id });
      ids.push(row!.id);
    }
    await message(channelId, owner.id, 'not pinned');
    const { socket, sent, participant } = joinNew(owner);
    try {
      await handlers['pins-list']!(socket, { conversationId: channelId });
      const first = events(sent, 'pins-list-result')[0];
      assert.equal(first.items.length, 25);
      assert.equal(first.hasMore, true);
      assert.equal(first.items[0].message.msgId, ids.at(-1));
      assert.equal(first.items[0].message.pinned, true);
      await handlers['pins-list']!(socket, { conversationId: channelId, before: first.items.at(-1).pinnedAt });
      const second = events(sent, 'pins-list-result')[1];
      assert.deepEqual(second.items.map((item: any) => item.message.msgId), [ids[1], ids[0]]);
      assert.equal(second.hasMore, false);
    } finally {
      cleanupParticipant(participant);
    }
  }));

  it('lights the dot for everyone but the pinner, until they open the pins', () => inServer(async ({ owner, member, channelId }) => {
    const msgId = await message(channelId, member.id);
    const ownerConn = joinNew(owner);
    const memberConn = joinNew(member);
    try {
      await handlers['message-pin']!(ownerConn.socket, { msgId, pinned: true, requestId: 'r1' });
      assert.deepEqual(await conversationsWithUnseenPins(owner.id, [channelId]), []);
      assert.deepEqual(await conversationsWithUnseenPins(member.id, [channelId]), [channelId]);
      await handlers['pins-ack']!(memberConn.socket, { conversationId: channelId });
      assert.deepEqual(await conversationsWithUnseenPins(member.id, [channelId]), []);
      assert.equal(events(memberConn.sent, 'pins-seen')[0].conversationId, channelId);
    } finally {
      cleanupParticipant(ownerConn.participant);
      cleanupParticipant(memberConn.participant);
    }
  }));

  it('in a DM either side may pin, and deleting the message keeps the notice pointing at nothing', async () => {
    const a = await makeUser('pd'); const b = await makeUser('pd');
    await befriend(a.id, b.id);
    const { conversation } = await getOrCreateDirect(a.id, b.id, a.id);
    const msgId = await message(conversation.id, a.id);
    const { socket, sent, participant } = joinNew(b);
    try {
      await handlers['message-pin']!(socket, { msgId, pinned: true, requestId: 'r1' });
      assert.equal(resultOf(sent, 'r1').error, undefined);
      assert.deepEqual(await conversationsWithUnseenPins(a.id, [conversation.id]), [conversation.id]);
    } finally {
      cleanupParticipant(participant);
    }
    const author = joinNew(a);
    try {
      await messageHandlers['chat-delete']!(author.socket, { msgId, requestId: 'r2' });
    } finally {
      cleanupParticipant(author.participant);
    }
    const [notice] = await db.select().from(messages).where(and(eq(messages.conversationId, conversation.id), eq(messages.kind, 'pin_notice')));
    assert.equal(notice!.pinnedMessageId, null);
    const [row] = await db.select({ lastPinAt: conversations.lastPinAt }).from(conversations).where(eq(conversations.id, conversation.id));
    assert.ok(row!.lastPinAt);
  });
});

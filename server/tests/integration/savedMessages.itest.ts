import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { messages, savedMessages, serverMembers } from '../../src/db/schema.js';
import { handlers as messageHandlers } from '../../src/modules/messages/messages.js';
import { handlers, MAX_SAVED_MESSAGES, savedMessageIds } from '../../src/modules/messages/savedMessages.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

type Sent = { event: string; payload: any }[];
const resultOf = (sent: Sent, requestId: string) => sent.find((s) => s.event === 'chat-action-result' && s.payload.requestId === requestId)?.payload;
const events = (sent: Sent, name: string) => sent.filter((s) => s.event === name).map((s) => s.payload);

async function message(conversationId: string, authorId: string, text = 'guardar'): Promise<number> {
  const [row] = await db.insert(messages).values({ conversationId, authorId, text }).returning({ id: messages.id });
  return row!.id;
}

describe('saved messages (real Postgres)', () => {
  it('saves and unsaves, telling only the account that saved', async () => {
    const owner = await makeUser('sv'); const member = await makeUser('sm');
    const { textChannelId } = await makeServerWithMembers(owner.id, [member.id]);
    const msgId = await message(textChannelId, owner.id);
    const mine = joinNew(member);
    const theirs = joinNew(owner);
    try {
      await handlers['message-save']!(mine.socket, { msgId, saved: true, requestId: 'r1' });
      assert.deepEqual(resultOf(mine.sent, 'r1'), { t: 'chat-action-result', requestId: 'r1' });
      assert.equal(events(mine.sent, 'saved-updated')[0].saved, true);
      assert.equal(events(theirs.sent, 'saved-updated').length, 0);
      assert.deepEqual(await savedMessageIds(member.id), [msgId]);
      await handlers['message-save']!(mine.socket, { msgId, saved: false, requestId: 'r2' });
      assert.equal(events(mine.sent, 'saved-updated')[1].saved, false);
      assert.deepEqual(await savedMessageIds(member.id), []);
    } finally {
      cleanupParticipant(mine.participant);
      cleanupParticipant(theirs.participant);
    }
  });

  it('refuses a message the account cannot read, and stops at the limit', async () => {
    const owner = await makeUser('sv'); const outsider = await makeUser('so');
    const { textChannelId } = await makeServerWithMembers(owner.id, []);
    const hidden = await message(textChannelId, owner.id);
    const { socket, sent, participant } = joinNew(outsider);
    try {
      await handlers['message-save']!(socket, { msgId: hidden, saved: true, requestId: 'r1' });
      assert.equal(resultOf(sent, 'r1').error.code, 'not_found');
    } finally {
      cleanupParticipant(participant);
    }
    const ownerConn = joinNew(owner);
    try {
      const ids = await db.insert(messages).values(Array.from({ length: MAX_SAVED_MESSAGES }, (_, i) => ({ conversationId: textChannelId, authorId: owner.id, text: `m${i}` }))).returning({ id: messages.id });
      await db.insert(savedMessages).values(ids.map((r) => ({ userId: owner.id, messageId: r.id, conversationId: textChannelId })));
      await handlers['message-save']!(ownerConn.socket, { msgId: hidden, saved: true, requestId: 'r2' });
      assert.equal(resultOf(ownerConn.sent, 'r2').error.code, 'saved_full');
    } finally {
      cleanupParticipant(ownerConn.participant);
    }
  });

  it('lists what was saved, keeps what the account lost access to as missing, and drops what was deleted', async () => {
    const owner = await makeUser('sv'); const member = await makeUser('sm');
    const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [member.id]);
    const kept = await message(textChannelId, owner.id, 'fica');
    const deleted = await message(textChannelId, owner.id, 'some');
    const mine = joinNew(member);
    try {
      await handlers['message-save']!(mine.socket, { msgId: kept, saved: true, requestId: 'r1' });
      await handlers['message-save']!(mine.socket, { msgId: deleted, saved: true, requestId: 'r2' });
      const author = joinNew(owner);
      try {
        await messageHandlers['chat-delete']!(author.socket, { msgId: deleted, requestId: 'r3' });
      } finally {
        cleanupParticipant(author.participant);
      }
      await handlers['saved-list']!(mine.socket, {});
      const list = events(mine.sent, 'saved-list-result')[0];
      assert.deepEqual(list.items.map((item: any) => [item.msgId, item.status]), [[kept, 'available']]);
      assert.equal(list.items[0].message.text, 'fica');

      await db.delete(serverMembers).where(eq(serverMembers.serverId, serverId));
      invalidateAllServers();
      await handlers['saved-list']!(mine.socket, {});
      const after = events(mine.sent, 'saved-list-result')[1];
      assert.deepEqual(after.items.map((item: any) => [item.msgId, item.status, item.message]), [[kept, 'missing', null]]);
      await handlers['message-save']!(mine.socket, { msgId: kept, saved: false, requestId: 'r4' });
      assert.deepEqual(await savedMessageIds(member.id), []);
    } finally {
      cleanupParticipant(mine.participant);
    }
  });
});

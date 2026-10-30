import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { conversationMembers, messages } from '../../src/db/schema.js';
import { handlers } from '../../src/modules/messages/messages.js';
import { markReadUpTo, unreadCountsForUser, UNREAD_COUNT_CAP } from '../../src/modules/conversations/conversationsRepository.js';
import { cleanupParticipant, db, joinNew, makeGroupWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

const HOUR = 60 * 60 * 1000;

async function post(conversationId: string, authorId: string, createdAt = new Date()): Promise<number> {
  const [row] = await db.insert(messages).values({ conversationId, authorId, text: 'x', createdAt }).returning({ id: messages.id });
  return row!.id;
}

/** A group whose reader joined an hour ago, so messages posted now count. */
async function groupWithReader() {
  const owner = await makeUser('ur');
  const reader = await makeUser('ur');
  const conversationId = await makeGroupWithMembers(owner.id, [reader.id]);
  await db.update(conversationMembers).set({ joinedAt: new Date(Date.now() - HOUR) })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, reader.id)));
  return { owner, reader, conversationId };
}

async function lastReadOf(conversationId: string, userId: string): Promise<number | null> {
  const [row] = await db.select({ id: conversationMembers.lastReadMessageId }).from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)));
  return row?.id ?? null;
}

describe('persisted unread (real Postgres)', () => {
  it('sends the first unread message before opening advances the read marker', async () => {
    const { owner, reader, conversationId } = await groupWithReader();
    await post(conversationId, owner.id, new Date(Date.now() - 2 * HOUR));
    const read = await post(conversationId, owner.id);
    await post(conversationId, reader.id);
    const unread = await post(conversationId, owner.id);
    await markReadUpTo(conversationId, reader.id, read);
    const tab = joinNew(reader);
    try {
      await handlers['conversation-open']!(tab.socket, { conversationId });
      const firstHistory = tab.sent.find((entry) => entry.event === 'conversation-history')?.payload;
      assert.equal(firstHistory?.firstUnreadMessageId, unread);
      assert.equal(await lastReadOf(conversationId, reader.id), unread);

      tab.sent.length = 0;
      await handlers['conversation-open']!(tab.socket, { conversationId });
      const secondHistory = tab.sent.find((entry) => entry.event === 'conversation-history')?.payload;
      assert.equal(secondHistory?.firstUnreadMessageId, null);
    } finally {
      cleanupParticipant(tab.participant);
    }
  });

  it("counts others' messages past the read marker, never your own or those from before joining", async () => {
    const { owner, reader, conversationId } = await groupWithReader();
    await post(conversationId, owner.id, new Date(Date.now() - 2 * HOUR));
    const read = await post(conversationId, owner.id);
    await post(conversationId, owner.id);
    await post(conversationId, reader.id);
    await post(conversationId, owner.id);

    assert.deepEqual(await unreadCountsForUser(reader.id, [conversationId]), { [conversationId]: 3 });
    await markReadUpTo(conversationId, reader.id, read);
    assert.deepEqual(await unreadCountsForUser(reader.id, [conversationId]), { [conversationId]: 2 });
  });

  it('leaves out conversations with nothing unread and stops counting at the cap', async () => {
    const { owner, reader, conversationId } = await groupWithReader();
    const quiet = await groupWithReader();
    await db.insert(messages).values(Array.from({ length: UNREAD_COUNT_CAP + 5 }, () => ({ conversationId, authorId: owner.id, text: 'x' })));
    await db.insert(conversationMembers).values({ conversationId: quiet.conversationId, userId: reader.id, joinedAt: new Date(Date.now() - HOUR) });

    assert.deepEqual(await unreadCountsForUser(reader.id, [conversationId, quiet.conversationId]), { [conversationId]: UNREAD_COUNT_CAP });
  });

  it('the read marker only moves forward, and only to a message of that conversation', async () => {
    const { owner, reader, conversationId } = await groupWithReader();
    const other = await groupWithReader();
    const first = await post(conversationId, owner.id);
    const second = await post(conversationId, owner.id);
    const elsewhere = await post(other.conversationId, other.owner.id);

    assert.equal(await markReadUpTo(conversationId, reader.id, second), true);
    assert.equal(await markReadUpTo(conversationId, reader.id, first), false);
    assert.equal(await markReadUpTo(conversationId, reader.id, elsewhere), false);
    assert.equal(await lastReadOf(conversationId, reader.id), second);
  });

  it("mark-read tells the reader's other tabs, and does nothing for a non-member", async () => {
    const { owner, reader, conversationId } = await groupWithReader();
    const stranger = await makeUser('ur');
    const msgId = await post(conversationId, owner.id);
    const tab = joinNew(reader);
    const otherTab = joinNew(reader);
    const outsider = joinNew(stranger);
    try {
      await handlers['conversation-mark-read']!(outsider.socket, { conversationId, msgId });
      await handlers['conversation-mark-read']!(tab.socket, { conversationId, msgId });

      assert.equal(await lastReadOf(conversationId, reader.id), msgId);
      const reads = (sent: { event: string; payload: any }[]) => sent.filter((s) => s.event === 'conversation-read').map((s) => s.payload);
      assert.deepEqual(reads(otherTab.sent), [{ t: 'conversation-read', conversationId, lastReadMessageId: msgId }]);
      assert.deepEqual(reads(tab.sent), []);
    } finally {
      cleanupParticipant(tab.participant);
      cleanupParticipant(otherTab.participant);
      cleanupParticipant(outsider.participant);
    }
  });
});

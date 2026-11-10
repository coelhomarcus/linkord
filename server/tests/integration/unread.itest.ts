import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { channelPermissionOverwrites, channelReadStates, conversations, serverMembers, messages } from '../../src/db/schema.js';
import { handlers } from '../../src/modules/messages/messages.js';
import { markReadUpTo, unreadCountsForUser, UNREAD_COUNT_CAP } from '../../src/modules/conversations/conversationsRepository.js';
import { PERMISSIONS } from '../../src/modules/servers/permissions.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

const HOUR = 60 * 60 * 1000;

async function post(conversationId: string, authorId: string, createdAt = new Date()): Promise<number> {
  const [row] = await db.insert(messages).values({ conversationId, authorId, text: 'x', createdAt }).returning({ id: messages.id });
  return row!.id;
}

/** A channel whose reader joined an hour ago, so messages posted now count. */
async function channelWithReader() {
  const owner = await makeUser('ur');
  const reader = await makeUser('ur');
  const { serverId, textChannelId: conversationId } = await makeServerWithMembers(owner.id, [reader.id]);
  await db.update(serverMembers).set({ joinedAt: new Date(Date.now() - HOUR) })
    .where(and(eq(serverMembers.serverId, serverId), eq(serverMembers.userId, reader.id)));
  return { owner, reader, serverId, conversationId };
}

/** Another text channel in the server, hidden from `hiddenFrom` when given. */
async function addTextChannel(serverId: string, ownerId: string, hiddenFrom?: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(conversations).values({ id, type: 'text', title: 'extra', createdBy: ownerId, serverId, permissionsSynced: false });
  if (hiddenFrom) {
    await db.insert(channelPermissionOverwrites).values({ id: crypto.randomUUID(), serverId, channelId: id, userId: hiddenFrom, deny: PERMISSIONS.VIEW_CHANNEL });
  }
  invalidateAllServers();
  return id;
}

const readsIn = (sent: { event: string; payload: any }[]) => sent.filter((s) => s.event === 'conversation-read').map((s) => s.payload);

async function channel(id: string) {
  const [row] = await db.select().from(conversations).where(eq(conversations.id, id));
  return row!;
}

async function lastReadOf(conversationId: string, userId: string): Promise<number | null> {
  const [row] = await db.select({ id: channelReadStates.lastReadMessageId }).from(channelReadStates)
    .where(and(eq(channelReadStates.channelId, conversationId), eq(channelReadStates.userId, userId)));
  return row?.id ?? null;
}

describe('persisted unread (real Postgres)', () => {
  it('sends the first unread message before opening advances the read marker', async () => {
    const { owner, reader, conversationId } = await channelWithReader();
    await post(conversationId, owner.id, new Date(Date.now() - 2 * HOUR));
    const read = await post(conversationId, owner.id);
    await post(conversationId, reader.id);
    const unread = await post(conversationId, owner.id);
    await markReadUpTo(await channel(conversationId), reader.id, read);
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
    const { owner, reader, conversationId } = await channelWithReader();
    await post(conversationId, owner.id, new Date(Date.now() - 2 * HOUR));
    const read = await post(conversationId, owner.id);
    await post(conversationId, owner.id);
    await post(conversationId, reader.id);
    await post(conversationId, owner.id);

    assert.deepEqual(await unreadCountsForUser(reader.id, [conversationId]), { [conversationId]: 3 });
    await markReadUpTo(await channel(conversationId), reader.id, read);
    assert.deepEqual(await unreadCountsForUser(reader.id, [conversationId]), { [conversationId]: 2 });
  });

  it('leaves out conversations with nothing unread and stops counting at the cap', async () => {
    const { owner, reader, conversationId } = await channelWithReader();
    const quiet = await channelWithReader();
    await db.insert(messages).values(Array.from({ length: UNREAD_COUNT_CAP + 5 }, () => ({ conversationId, authorId: owner.id, text: 'x' })));

    assert.deepEqual(await unreadCountsForUser(reader.id, [conversationId, quiet.conversationId]), { [conversationId]: UNREAD_COUNT_CAP });
  });

  it('the read marker only moves forward, and only to a message of that conversation', async () => {
    const { owner, reader, conversationId } = await channelWithReader();
    const other = await channelWithReader();
    const first = await post(conversationId, owner.id);
    const second = await post(conversationId, owner.id);
    const elsewhere = await post(other.conversationId, other.owner.id);

    assert.equal(await markReadUpTo(await channel(conversationId), reader.id, second), true);
    assert.equal(await markReadUpTo(await channel(conversationId), reader.id, first), false);
    assert.equal(await markReadUpTo(await channel(conversationId), reader.id, elsewhere), false);
    assert.equal(await lastReadOf(conversationId, reader.id), second);
  });

  it("mark-read tells the reader's other tabs, and does nothing for a non-member", async () => {
    const { owner, reader, conversationId } = await channelWithReader();
    const stranger = await makeUser('ur');
    const msgId = await post(conversationId, owner.id);
    const tab = joinNew(reader);
    const otherTab = joinNew(reader);
    const outsider = joinNew(stranger);
    try {
      await handlers['conversation-mark-read']!(outsider.socket, { conversationId, msgId });
      await handlers['conversation-mark-read']!(tab.socket, { conversationId, msgId });

      assert.equal(await lastReadOf(conversationId, reader.id), msgId);
      assert.deepEqual(readsIn(otherTab.sent), [{ t: 'conversation-read', conversationId, lastReadMessageId: msgId }]);
      assert.deepEqual(readsIn(tab.sent), []);
    } finally {
      cleanupParticipant(tab.participant);
      cleanupParticipant(otherTab.participant);
      cleanupParticipant(outsider.participant);
    }
  });

  it('mark server as read moves every visible channel to its newest message and tells every tab', async () => {
    const { owner, reader, serverId, conversationId } = await channelWithReader();
    const second = await addTextChannel(serverId, owner.id);
    const hidden = await addTextChannel(serverId, owner.id, reader.id);
    const quiet = await addTextChannel(serverId, owner.id);
    await post(conversationId, owner.id);
    const newestFirst = await post(conversationId, owner.id);
    const newestSecond = await post(second, owner.id);
    await post(hidden, owner.id);
    const tab = joinNew(reader);
    const otherTab = joinNew(reader);
    try {
      await handlers['server-mark-all-read']!(tab.socket, { serverId });

      assert.equal(await lastReadOf(conversationId, reader.id), newestFirst);
      assert.equal(await lastReadOf(second, reader.id), newestSecond);
      assert.equal(await lastReadOf(hidden, reader.id), null);
      assert.equal(await lastReadOf(quiet, reader.id), null);
      assert.deepEqual(await unreadCountsForUser(reader.id, [conversationId, second]), {});
      const expected = [
        { t: 'conversation-read', conversationId, lastReadMessageId: newestFirst },
        { t: 'conversation-read', conversationId: second, lastReadMessageId: newestSecond },
      ];
      const byId = (a: { conversationId: string }, b: { conversationId: string }) => a.conversationId.localeCompare(b.conversationId);
      assert.deepEqual(readsIn(tab.sent).sort(byId), [...expected].sort(byId));
      assert.deepEqual(readsIn(otherTab.sent).sort(byId), [...expected].sort(byId));

      // nothing left to move: no second round of events
      tab.sent.length = 0;
      await handlers['server-mark-all-read']!(tab.socket, { serverId });
      assert.deepEqual(readsIn(tab.sent), []);
    } finally {
      cleanupParticipant(tab.participant);
      cleanupParticipant(otherTab.participant);
    }
  });

  it('mark server as read does nothing for someone outside the server', async () => {
    const { owner, serverId, conversationId } = await channelWithReader();
    const stranger = await makeUser('ur');
    await post(conversationId, owner.id);
    const outsider = joinNew(stranger);
    try {
      await handlers['server-mark-all-read']!(outsider.socket, { serverId });
      assert.equal(await lastReadOf(conversationId, stranger.id), null);
      assert.deepEqual(readsIn(outsider.sent), []);
    } finally {
      cleanupParticipant(outsider.participant);
    }
  });

  it('mark as read reaches the newest message even when the client never loaded it', async () => {
    const { owner, reader, conversationId } = await channelWithReader();
    await post(conversationId, owner.id);
    const newest = await post(conversationId, owner.id);
    const tab = joinNew(reader);
    try {
      await handlers['conversation-mark-all-read']!(tab.socket, { conversationId });
      assert.equal(await lastReadOf(conversationId, reader.id), newest);
      assert.deepEqual(readsIn(tab.sent), [{ t: 'conversation-read', conversationId, lastReadMessageId: newest }]);
    } finally {
      cleanupParticipant(tab.participant);
    }
  });
});

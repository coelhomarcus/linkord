import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { outboxEvents } from '../../src/db/schema.js';
import { acceptFriendRequest, requestFriendship } from '../../src/modules/friendships/friendshipsRepository.js';
import { drainOutbox } from '../../src/modules/notifications/outboxWorker.js';
import { cleanupParticipant, db, joinNew, makeUser, pool } from './helpers.js';

after(async () => { await pool.end(); });

// the worker leaves events younger than a second for the transaction that wrote them to settle, and
// compares with this process's clock what the database's clock stamped
async function drainNow(audienceUserId: string) {
  const past = new Date(Date.now() - 5000);
  await db.update(outboxEvents).set({ createdAt: past, nextAttemptAt: past }).where(eq(outboxEvents.audienceUserId, audienceUserId));
  await drainOutbox();
}

const noticesIn = (sent: { event: string; payload: any }[]) => sent.filter((entry) => entry.event === 'notice').map((entry) => entry.payload.notice);

describe('live notices (real Postgres)', () => {
  it('a friend request and its acceptance reach the other side’s open tabs once, as the push words them', async () => {
    const asker = await makeUser('ln');
    const asked = await makeUser('ln');
    const askerTab = joinNew(asker);
    const askedTab = joinNew(asked);
    try {
      assert.equal((await requestFriendship(asker.id, asked.username)).code, 'created');
      await drainNow(asked.id);
      const [request] = noticesIn(askedTab.sent);
      assert.equal(request?.kind, 'friend_request');
      assert.equal(request?.path, '/app/friends?tab=pending#received');
      assert.match(request?.title ?? '', new RegExp(asker.username));
      assert.equal(noticesIn(askerTab.sent).length, 0);

      await drainNow(asked.id);
      assert.equal(noticesIn(askedTab.sent).length, 1);

      assert.equal((await acceptFriendRequest(asked.id, asker.id)).code, 'accepted');
      await drainNow(asker.id);
      assert.deepEqual(noticesIn(askerTab.sent).map((notice) => notice.kind), ['friend_accepted']);
    } finally {
      cleanupParticipant(askerTab.participant);
      cleanupParticipant(askedTab.participant);
    }
  });

  it('a request already answered by the time the worker runs shows nothing', async () => {
    const asker = await makeUser('ln');
    const asked = await makeUser('ln');
    const askedTab = joinNew(asked);
    try {
      await requestFriendship(asker.id, asked.username);
      await acceptFriendRequest(asked.id, asker.id);
      await drainNow(asked.id);
      assert.equal(noticesIn(askedTab.sent).filter((notice) => notice.kind === 'friend_request').length, 0);
    } finally {
      cleanupParticipant(askedTab.participant);
    }
  });
});

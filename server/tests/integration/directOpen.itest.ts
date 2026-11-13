import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { conversations } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { blockUser } from '../../src/modules/blocks/blocksRepository.js';
import { handlers } from '../../src/modules/conversations/conversations.js';
import {
  dmKeyFor, getOrCreateDirect, listConversationMemberIds, shareAnyConversation, touchConversation,
} from '../../src/modules/conversations/conversationsRepository.js';
import { befriend, cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

async function asUser(userId: string) {
  const token = (await createSession(userId)).rawToken;
  return { cookie: `${config.SESSION_COOKIE}=${token}` };
}

async function profileStatus(viewerId: string, targetId: string): Promise<number[]> {
  const headers = await asUser(viewerId);
  return Promise.all(['profile', 'profile-details', 'wall'].map(async (path) => (
    (await app.inject({ method: 'GET', url: `/api/users/${targetId}/${path}`, headers })).statusCode
  )));
}

async function directExists(a: string, b: string): Promise<boolean> {
  const [row] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.dmKey, dmKeyFor(a, b))).limit(1);
  return !!row;
}

describe('direct-open (real Postgres)', () => {
  it('with a stranger creates nothing and reveals nothing: no DM, no presence, profile still 404', async () => {
    const a = await makeUser('att'); const b = await makeUser('vic');
    assert.deepEqual(await profileStatus(a.id, b.id), [404, 404, 404]);

    const { socket, sent, participant } = joinNew(a);
    try {
      await handlers['direct-open']!(socket, { userId: b.id });
      assert.deepEqual(sent.filter((s) => s.event === 'conversation-opened' || s.event === 'presence-sync'), []);
    } finally { cleanupParticipant(participant); }

    assert.equal(await directExists(a.id, b.id), false);
    assert.deepEqual(await profileStatus(a.id, b.id), [404, 404, 404]);
  });

  it('with a friend opens the DM for the opener', async () => {
    const a = await makeUser('me'); const b = await makeUser('fr');
    await befriend(a.id, b.id);
    const { socket, sent, participant } = joinNew(a);
    try {
      await handlers['direct-open']!(socket, { userId: b.id });
      const opened = sent.find((s) => s.event === 'conversation-opened');
      assert.ok(opened);
      assert.deepEqual([...opened.payload.conversation.memberIds].sort(), [a.id, b.id].sort());
    } finally { cleanupParticipant(participant); }
  });

  it('is refused when either side blocked the other, even between former friends', async () => {
    const a = await makeUser('me'); const b = await makeUser('bl');
    await befriend(a.id, b.id);
    await blockUser(b.id, a.id);
    const { socket, sent, participant } = joinNew(a);
    try {
      await handlers['direct-open']!(socket, { userId: b.id });
      assert.equal(sent.some((s) => s.event === 'conversation-opened'), false);
    } finally { cleanupParticipant(participant); }
    assert.equal(await directExists(a.id, b.id), false);
  });
});

describe('an empty DM is not a shared conversation (real Postgres)', () => {
  it('counts for profile access and known peers only once a message was sent in it', async () => {
    const a = await makeUser('me'); const b = await makeUser('ot');
    const { conversation } = await getOrCreateDirect(a.id, b.id, a.id);

    assert.equal(await shareAnyConversation(a.id, b.id), false);
    assert.equal((await listConversationMemberIds(a.id)).includes(b.id), false);
    assert.deepEqual(await profileStatus(a.id, b.id), [404, 404, 404]);

    await touchConversation(conversation.id);
    assert.equal(await shareAnyConversation(a.id, b.id), true);
    assert.equal((await listConversationMemberIds(a.id)).includes(b.id), true);
    assert.deepEqual(await profileStatus(a.id, b.id), [200, 200, 200]);
  });

  it('a server channel still counts without any message', async () => {
    const a = await makeUser('me'); const b = await makeUser('ot');
    await makeServerWithMembers(a.id, [b.id]);
    assert.equal(await shareAnyConversation(a.id, b.id), true);
    assert.equal((await listConversationMemberIds(a.id)).includes(b.id), true);
  });
});

describe('profile access and blocks (real Postgres)', () => {
  it('a block by the target hides profile, details and Wall, even with a server in common', async () => {
    const viewer = await makeUser('vw'); const target = await makeUser('tg');
    await makeServerWithMembers(target.id, [viewer.id]);
    assert.deepEqual(await profileStatus(viewer.id, target.id), [200, 200, 200]);

    await blockUser(target.id, viewer.id);
    assert.deepEqual(await profileStatus(viewer.id, target.id), [404, 404, 404]);
    // the blocker still sees it: their view of the profile is where "Unblock" lives
    assert.deepEqual(await profileStatus(target.id, viewer.id), [200, 200, 200]);
  });
});

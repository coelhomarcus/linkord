import { uploadDir } from './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { conversationMembers, groupSounds } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { setCallConversationId } from '../../src/modules/presence/participants.js';
import { deleteGroupCompletely } from '../../src/modules/conversations/groupDeletion.js';
import { handlers, MAX_SOUNDS_PER_GROUP } from '../../src/modules/soundboard/soundboard.js';
import { silentWav } from '../modules/soundboard/wavFixture.js';
import { cleanupParticipant, db, joinNew, makeGroupWithMembers, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

interface Actor { id: string; username: string; token: string }
async function actor(prefix: string): Promise<Actor> {
  const user = await makeUser(prefix);
  return { ...user, token: (await createSession(user.id)).rawToken };
}

const cookie = (as: Actor) => ({ cookie: `${config.SESSION_COOKIE}=${as.token}` });

async function upload(as: Actor, groupId: string, name: string, body: Buffer = silentWav({ seconds: 1 })) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/groups/${groupId}/sounds?name=${encodeURIComponent(name)}&emoji=${encodeURIComponent('🥁')}&volume=80`,
    payload: body,
    headers: { ...cookie(as), 'content-type': 'audio/wav' },
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function world() {
  const [owner, member, other, stranger] = await Promise.all(['own', 'mem', 'oth', 'str'].map(actor)) as [Actor, Actor, Actor, Actor];
  const groupId = await makeGroupWithMembers(owner.id, [member.id, other.id], 'sounds');
  return { owner, member, other, stranger, groupId };
}

describe('group soundboard', () => {
  it('any member uploads; the list shows it with its uploader; non-members get 404', async () => {
    const { owner, member, stranger, groupId } = await world();
    const created = await upload(member, groupId, 'ba dum tss');
    assert.equal(created.status, 201);
    assert.equal(created.body.sound.name, 'ba dum tss');
    assert.equal(created.body.sound.emoji, '🥁');
    assert.equal(created.body.sound.volume, 80);
    assert.equal(created.body.sound.durationMs, 1000);
    assert.equal(created.body.sound.uploader.id, member.id);
    assert.ok(fs.existsSync(path.join(uploadDir, created.body.sound.id)));

    const list = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/sounds`, headers: cookie(owner) });
    assert.equal(list.statusCode, 200);
    assert.deepEqual(JSON.parse(list.body).sounds.map((s: { id: string }) => s.id), [created.body.sound.id]);

    assert.equal((await upload(stranger, groupId, 'nope')).status, 404);
    const strangerList = await app.inject({ method: 'GET', url: `/api/groups/${groupId}/sounds`, headers: cookie(stranger) });
    assert.equal(strangerList.statusCode, 404);
  });

  it('refuses audio that is not WAV, or longer than the limit', async () => {
    const { member, groupId } = await world();
    const notWav = await upload(member, groupId, 'mp3', Buffer.from('ID3'.padEnd(64, 'x')));
    assert.deepEqual([notWav.status, notWav.body.error.code], [400, 'invalid_sound']);
    const tooLong = await upload(member, groupId, 'long', silentWav({ seconds: 5.5, sampleRate: 22050 }));
    assert.deepEqual([tooLong.status, tooLong.body.error.code], [400, 'sound_too_long']);
    assert.equal((await db.select().from(groupSounds).where(eq(groupSounds.conversationId, groupId))).length, 0);
  });

  it('stops at the per-group limit, even for concurrent uploads', async () => {
    const { owner, groupId } = await world();
    for (let i = 0; i < MAX_SOUNDS_PER_GROUP - 2; i++) {
      await db.insert(groupSounds).values({ id: `${groupId.slice(0, 8)}${String(i).padStart(24, '0')}`, conversationId: groupId, name: `s${i}`, size: 1, durationMs: 1 });
    }
    const results = await Promise.all([1, 2, 3, 4].map((i) => upload(owner, groupId, `race ${i}`)));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 201, 409, 409]);
    assert.ok(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'soundboard_full'));
  });

  it('only the uploader or the owner edits and removes a sound', async () => {
    const { owner, member, other, groupId } = await world();
    const { body } = await upload(member, groupId, 'mine');
    const soundUrl = `/api/groups/${groupId}/sounds/${body.sound.id}`;

    const denied = await app.inject({ method: 'PATCH', url: soundUrl, payload: { name: 'hijack' }, headers: cookie(other) });
    assert.equal(denied.statusCode, 403);
    const renamed = await app.inject({ method: 'PATCH', url: soundUrl, payload: { name: 'renamed', emoji: '', volume: 40 }, headers: cookie(member) });
    assert.equal(renamed.statusCode, 200);
    assert.deepEqual([JSON.parse(renamed.body).sound.name, JSON.parse(renamed.body).sound.emoji, JSON.parse(renamed.body).sound.volume], ['renamed', '', 40]);

    assert.equal((await app.inject({ method: 'DELETE', url: soundUrl, headers: cookie(other) })).statusCode, 403);
    assert.equal((await app.inject({ method: 'DELETE', url: soundUrl, headers: cookie(owner) })).statusCode, 204);
    assert.equal(fs.existsSync(path.join(uploadDir, body.sound.id)), false);
  });

  it('serves the file to members only, revalidating by ETag', async () => {
    const { owner, member, stranger, groupId } = await world();
    const { body } = await upload(member, groupId, 'file');
    const url = `/api/groups/${groupId}/sounds/${body.sound.id}/file`;
    const ok = await app.inject({ method: 'GET', url, headers: cookie(owner) });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers['content-type'], 'audio/wav');
    assert.equal(ok.rawPayload.subarray(0, 4).toString('ascii'), 'RIFF');
    const cached = await app.inject({ method: 'GET', url, headers: { ...cookie(owner), 'if-none-match': String(ok.headers.etag) } });
    assert.equal(cached.statusCode, 304);
    assert.equal((await app.inject({ method: 'GET', url, headers: { ...cookie(stranger), 'if-none-match': String(ok.headers.etag) } })).statusCode, 404);
  });

  it('plays only for participants in that group call', async () => {
    const { owner, member, other, groupId } = await world();
    const { body } = await upload(member, groupId, 'play');
    const a = joinNew(member);
    const b = joinNew(owner);
    const c = joinNew(other);
    try {
      setCallConversationId(a.participant, groupId);
      setCallConversationId(b.participant, groupId);
      const plays = (sent: { event: string }[]) => sent.filter((m) => m.event === 'soundboard-play');

      await handlers['soundboard-play']!(c.socket, { conversationId: groupId, soundId: body.sound.id });
      assert.equal(plays(b.sent).length, 0, 'someone outside the call cannot play');

      await handlers['soundboard-play']!(a.socket, { conversationId: groupId, soundId: body.sound.id });
      assert.equal(plays(a.sent).length, 1);
      assert.deepEqual(plays(b.sent).map((m: any) => [m.payload.soundId, m.payload.participantId, m.payload.volume]), [[body.sound.id, a.participant.id, 80]]);
      assert.equal(plays(c.sent).length, 0, 'a member outside the call does not hear it');

      await db.delete(conversationMembers).where(eq(conversationMembers.userId, member.id));
      await handlers['soundboard-play']!(a.socket, { conversationId: groupId, soundId: body.sound.id });
      assert.equal(plays(b.sent).length, 1, 'a removed member cannot play while the call is being cut');
    } finally {
      for (const j of [a, b, c]) cleanupParticipant(j.participant);
    }
  });

  it('deleting the group deletes its sound files', async () => {
    const { owner, groupId } = await world();
    const { body } = await upload(owner, groupId, 'gone');
    await deleteGroupCompletely(groupId);
    assert.equal(fs.existsSync(path.join(uploadDir, body.sound.id)), false);
    assert.equal((await db.select().from(groupSounds).where(eq(groupSounds.id, body.sound.id))).length, 0);
  });
});

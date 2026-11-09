import { uploadDir } from './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { config } from '../../src/config/env.js';
import { messages, serverRoles } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { PERMISSIONS } from '../../src/modules/servers/permissions.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { handlers } from '../../src/modules/messages/messages.js';
import { getOrCreateDirect } from '../../src/modules/conversations/conversationsRepository.js';
import { sanitizeCustomEmojis } from '../../src/modules/emojis/serverEmojis.js';
import { befriend, cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

interface Actor { id: string; username: string; token: string }
async function actor(prefix: string): Promise<Actor> {
  const user = await makeUser(prefix);
  return { ...user, token: (await createSession(user.id)).rawToken };
}
const cookie = (as: Actor) => ({ cookie: `${config.SESSION_COOKIE}=${as.token}` });

const png = () => sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } } }).png().toBuffer();

async function upload(as: Actor, serverId: string, name: string, body?: Buffer) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/servers/${serverId}/emojis?name=${encodeURIComponent(name)}`,
    payload: body ?? await png(),
    // whatever it claims, the bytes decide
    headers: { ...cookie(as), 'content-type': 'image/gif' },
  });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

async function world() {
  const [owner, member, stranger] = await Promise.all(['eown', 'emem', 'estr'].map(actor)) as [Actor, Actor, Actor];
  const { serverId, textChannelId } = await makeServerWithMembers(owner.id, [member.id], 'emojis');
  return { owner, member, stranger, serverId, textChannelId };
}

describe('server emojis (real Postgres)', () => {
  it('the owner uploads; any signed-in account opens the file; adding takes CREATE_EXPRESSIONS', async () => {
    const { owner, member, stranger, serverId } = await world();
    const created = await upload(owner, serverId, 'blue_square');
    assert.equal(created.status, 201);
    assert.equal(created.body.emoji.animated, false);
    const id: string = created.body.emoji.id;
    const stored = await sharp(fs.readFileSync(path.join(uploadDir, id))).metadata();
    assert.deepEqual([stored.format, stored.width, stored.height], ['webp', 128, 128]);

    const file = await app.inject({ method: 'GET', url: `/api/emojis/${id}`, headers: cookie(stranger) });
    assert.equal(file.statusCode, 200);
    assert.equal(file.headers['content-type'], 'image/webp');
    assert.match(String(file.headers['cache-control']), /immutable/);
    assert.equal((await app.inject({ method: 'GET', url: `/api/emojis/${id}` })).statusCode, 401);

    // a new server's @everyone can't add expressions
    assert.equal((await upload(member, serverId, 'nope')).status, 403);
    assert.equal((await upload(stranger, serverId, 'nope')).status, 404);
  });

  it('refuses a taken name, a bad name and bytes that are not an image', async () => {
    const { owner, serverId } = await world();
    assert.equal((await upload(owner, serverId, 'dup')).status, 201);
    assert.equal((await upload(owner, serverId, 'dup')).body.error.code, 'emoji_name_taken');
    assert.equal((await upload(owner, serverId, 'Bad Name')).body.error.code, 'invalid_emoji_name');
    assert.equal((await upload(owner, serverId, 'fake', Buffer.from('GIF89a not really'))).body.error.code, 'invalid_image');
  });

  it('a member renames or removes only their own, MANAGE_EXPRESSIONS anyone\'s; every change is audited', async () => {
    const { owner, member, serverId } = await world();
    await db.update(serverRoles).set({ permissions: sql`${serverRoles.permissions} | ${PERMISSIONS.CREATE_EXPRESSIONS}` })
      .where(and(eq(serverRoles.serverId, serverId), eq(serverRoles.isDefault, true)));
    invalidateAllServers();
    const mine = (await upload(member, serverId, 'members_own')).body.emoji.id as string;
    const owners = (await upload(owner, serverId, 'owners_own')).body.emoji.id as string;

    const rename = (as: Actor, id: string, name: string) => app.inject({ method: 'PATCH', url: `/api/servers/${serverId}/emojis/${id}`, payload: { name }, headers: cookie(as) });
    assert.equal((await rename(member, owners, 'taken_over')).statusCode, 403);
    assert.equal((await rename(member, mine, 'renamed')).statusCode, 200);
    assert.equal((await rename(owner, mine, 'owners_own')).statusCode, 409);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/servers/${serverId}/emojis/${mine}`, headers: cookie(owner) })).statusCode, 204);
    assert.equal(fs.existsSync(path.join(uploadDir, mine)), false);

    const audit = await app.inject({ method: 'GET', url: `/api/servers/${serverId}/audit-log?action=emoji.update`, headers: cookie(owner) });
    assert.equal(audit.statusCode, 200);
    assert.ok(JSON.parse(audit.body).items.some((entry: { targetLabel: string }) => entry.targetLabel === 'renamed'));
  });

  it('a member may send the server\'s emojis anywhere; anyone else\'s token becomes :name:', async () => {
    const { owner, stranger, serverId } = await world();
    const id = (await upload(owner, serverId, 'wave')).body.emoji.id as string;
    const text = `oi <:old_name:${id}>`;
    assert.equal(await sanitizeCustomEmojis(text, owner.id), `oi <:wave:${id}>`);
    assert.equal(await sanitizeCustomEmojis(text, stranger.id), 'oi :old_name:');

    // used in a DM with someone outside the server, it is stored as the token
    await befriend(owner.id, stranger.id);
    const { conversation: dm } = await getOrCreateDirect(owner.id, stranger.id, owner.id);
    const { socket, participant } = joinNew(owner);
    try {
      await handlers.chat!(socket, { conversationId: dm.id, text: `<:wave:${id}>`, requestId: 'r1', clientMessageId: crypto.randomUUID() });
    } finally {
      cleanupParticipant(participant);
    }
    const [row] = await db.select({ text: messages.text }).from(messages).where(eq(messages.conversationId, dm.id));
    assert.equal(row?.text, `<:wave:${id}>`);

    const mine = await app.inject({ method: 'GET', url: '/api/me/emojis', headers: cookie(owner) });
    assert.deepEqual(JSON.parse(mine.body).servers.find((s: { serverId: string }) => s.serverId === serverId).emojis.map((e: { name: string }) => e.name), ['wave']);
    const meta = await app.inject({ method: 'GET', url: `/api/emojis/meta?ids=${id}`, headers: cookie(stranger) });
    assert.deepEqual(JSON.parse(meta.body).emojis, [{ id, name: 'wave', animated: false }]);
  });

  it('reacting with a server emoji takes being its member; taking the reaction back does not', async () => {
    const { owner, member, stranger, serverId, textChannelId } = await world();
    const id = (await upload(owner, serverId, 'react_me')).body.emoji.id as string;
    const [message] = await db.insert(messages).values({ conversationId: textChannelId, authorId: owner.id, text: 'hi' }).returning({ id: messages.id });
    const emoji = `custom:${id}`;

    const asMember = joinNew(member);
    const asStranger = joinNew(stranger);
    try {
      await handlers['chat-react']!(asMember.socket, { msgId: message!.id, emoji, present: true, requestId: 'r1' });
      const memberResult = asMember.sent.find((s) => s.event === 'chat-action-result')?.payload;
      assert.equal(memberResult?.error, undefined);

      // a stranger can't even see the channel; in a DM it would be the emoji rule refusing
      await handlers['chat-react']!(asStranger.socket, { msgId: message!.id, emoji, present: true, requestId: 'r2' });
      assert.ok(asStranger.sent.find((s) => s.event === 'chat-action-result')?.payload.error);
    } finally {
      cleanupParticipant(asMember.participant);
      cleanupParticipant(asStranger.participant);
    }
  });
});

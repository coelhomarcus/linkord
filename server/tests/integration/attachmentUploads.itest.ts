import { uploadDir } from './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import Fastify from 'fastify';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { config } from '../../src/config/env.js';
import { attachments as attachmentsTable, messageSendOperations, messages, serverMembers, stagedAttachments } from '../../src/db/schema.js';
import { invalidateAllServers } from '../../src/modules/servers/serverAccess.js';
import { getByMessageIds } from '../../src/modules/attachments/attachments.js';
import { getUsage } from '../../src/modules/attachments/attachmentQuota.js';
import { STAGED_TTL_MS, stagedFileIds, sweepExpiredStaged } from '../../src/modules/attachments/stagedAttachments.js';
import { expireIdleUploads, getReservedBytes } from '../../src/modules/attachments/uploadSession.js';
import { handlers as chatHandlers } from '../../src/modules/messages/messages.js';
import { registerAttachmentRoutes } from '../../src/modules/attachments/attachments.js';
import { createSession } from '../../src/modules/auth/session.js';
import { cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

const app = Fastify();
registerAttachmentRoutes(app);

after(async () => {
  await app.close();
  await pool.end();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

// Big enough that attachmentThumbnails.ts actually generates a thumbnail row
// (it skips images already within its max dimension).
const bigPng = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#3366ff' } }).png().toBuffer();

async function sessionFor(userId: string): Promise<string> {
  const { rawToken } = await createSession(userId);
  return `${config.SESSION_COOKIE}=${rawToken}`;
}

describe('staged upload and batch publishing (real Postgres)', () => {
  async function stage(cookie: string, conversationId: string, buffer = bigPng, fileName = 'photo.png'): Promise<string> {
    const init = await app.inject({
      method: 'POST', url: '/api/attachments/init', headers: { cookie },
      payload: { conversationId, fileName, mimeType: 'image/png', totalSize: buffer.length },
    });
    assert.equal(init.statusCode, 201, init.body);
    const { uploadId } = init.json() as { uploadId: string };
    const chunk = await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/chunk/0`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: buffer });
    assert.equal(chunk.statusCode, 200, chunk.body);
    const complete = await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/complete`, headers: { cookie }, payload: {} });
    assert.equal(complete.statusCode, 201, complete.body);
    return (complete.json() as { staged: { id: string } }).staged.id;
  }

  async function member() {
    const owner = await makeUser('st');
    const { serverId, textChannelId: conversationId } = await makeServerWithMembers(owner.id, []);
    return { owner, serverId, conversationId, cookie: await sessionFor(owner.id) };
  }

  const correlatedSend = async (owner: { id: string; username: string }, conversationId: string, attachmentIds: string[], text = '', clientMessageId = crypto.randomUUID()) => {
    const { socket, sent, participant } = joinNew(owner);
    try {
      await chatHandlers.chat!(socket, { conversationId, text, requestId: 'r', clientMessageId, attachmentIds });
      return sent.filter((s) => s.event === 'chat-send-result').map((s) => s.payload)[0];
    } finally {
      cleanupParticipant(participant);
    }
  };

  it('staging does not publish anything, does not serve the file to anyone, and counts toward the storage ceiling', async () => {
    const { conversationId, cookie } = await member();
    const before = await getUsage();
    const id = await stage(cookie, conversationId);

    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, conversationId))).length, 0);
    assert.equal((await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id))).length, 0);
    const served = await app.inject({ method: 'GET', url: `/uploads/${id}`, headers: { cookie } });
    assert.equal(served.statusCode, 404);
    const after = await getUsage();
    assert.ok(after.totalBytes >= before.totalBytes + bigPng.length, 'staged bytes count toward the instance total');
    assert.ok((await stagedFileIds()).includes(id), 'the orphan sweep sees the staged file');
  });

  it('a voice message keeps its duration and waveform from init through staging to the published attachment', async () => {
    const { owner, conversationId, cookie } = await member();
    const audio = Buffer.from('fake-opus-bytes');
    const voice = { durationMs: 4200, waveform: Buffer.from([10, 200, 90]).toString('base64') };
    const init = await app.inject({
      method: 'POST', url: '/api/attachments/init', headers: { cookie },
      payload: { conversationId, fileName: 'voice-message.webm', mimeType: 'audio/webm;codecs=opus', totalSize: audio.length, voice },
    });
    assert.equal(init.statusCode, 201, init.body);
    const { uploadId } = init.json() as { uploadId: string };
    await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/chunk/0`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: audio });
    const complete = await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/complete`, headers: { cookie }, payload: {} });
    assert.equal(complete.statusCode, 201, complete.body);
    assert.deepEqual((complete.json() as { staged: { voice?: unknown; mime: string } }).staged, { id: uploadId, name: 'voice-message.webm', mime: 'audio/webm', size: audio.length, voice });

    const result = await correlatedSend(owner, conversationId, [uploadId]) as { message?: { attachments?: { voice?: unknown }[] } };
    assert.deepEqual(result.message?.attachments?.[0]?.voice, voice);
    const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, uploadId));
    assert.equal(row?.voiceDurationMs, 4200);
  });

  it('refuses voice metadata the recorder could not have produced', async () => {
    const { conversationId, cookie } = await member();
    const init = (mimeType: string, voice: unknown) => app.inject({
      method: 'POST', url: '/api/attachments/init', headers: { cookie },
      payload: { conversationId, fileName: 'x', mimeType, totalSize: 10, voice },
    });
    for (const [mime, voice] of [['image/png', { durationMs: 1000, waveform: 'AA==' }], ['audio/webm', { durationMs: 60 * 60 * 1000, waveform: 'AA==' }], ['audio/webm', { durationMs: 1000, waveform: '' }]] as const) {
      const res = await init(mime, voice);
      assert.equal(res.statusCode, 400, `${mime} ${JSON.stringify(voice)}`);
      assert.equal(res.json().error.code, 'invalid_voice');
    }
  });

  const initAs = (cookie: string, conversationId: string, totalSize: number) => app.inject({
    method: 'POST', url: '/api/attachments/init', headers: { cookie },
    payload: { conversationId, fileName: 'big.bin', mimeType: 'application/octet-stream', totalSize },
  });
  const cancelAll = async (cookie: string, ids: string[]) => {
    for (const id of ids) await app.inject({ method: 'DELETE', url: `/api/attachments/${id}`, headers: { cookie } });
  };

  it('takes a file up to the configured size and refuses one byte more', async () => {
    const { conversationId, cookie } = await member();
    assert.equal(config.MAX_ATTACHMENT_BYTES, 512 * 1024 * 1024);
    const tooBig = await initAs(cookie, conversationId, config.MAX_ATTACHMENT_BYTES + 1);
    assert.equal(tooBig.statusCode, 400); assert.equal(tooBig.json().error.code, 'invalid_size');
    const accepted = await initAs(cookie, conversationId, config.MAX_ATTACHMENT_BYTES);
    assert.equal(accepted.statusCode, 201, accepted.body);
    await cancelAll(cookie, [(accepted.json() as { uploadId: string }).uploadId]);
  });

  it('one account reserves at most one message of the largest files before sending them, and others are not affected', async () => {
    const hoarder = await member();
    const other = await member();
    const ids: string[] = [];
    for (let i = 0; i < config.MAX_ATTACHMENTS_PER_MESSAGE; i++) {
      const accepted = await initAs(hoarder.cookie, hoarder.conversationId, config.MAX_ATTACHMENT_BYTES);
      assert.equal(accepted.statusCode, 201, accepted.body);
      ids.push((accepted.json() as { uploadId: string }).uploadId);
    }
    const refused = await initAs(hoarder.cookie, hoarder.conversationId, 1);
    assert.equal(refused.statusCode, 409); assert.equal(refused.json().error.code, 'quota_exceeded');

    const fine = await initAs(other.cookie, other.conversationId, 1024);
    assert.equal(fine.statusCode, 201, fine.body);
    await cancelAll(other.cookie, [(fine.json() as { uploadId: string }).uploadId]);

    // cancelling gives the room back
    await cancelAll(hoarder.cookie, ids.splice(0, 1));
    const again = await initAs(hoarder.cookie, hoarder.conversationId, config.MAX_ATTACHMENT_BYTES);
    assert.equal(again.statusCode, 201, again.body);
    ids.push((again.json() as { uploadId: string }).uploadId);
    await cancelAll(hoarder.cookie, ids);
  });

  it('staged files count toward what an account has not sent yet', async () => {
    const { owner, conversationId, cookie } = await member();
    await stage(cookie, conversationId);
    // the thumbnail is on disk too, so it counts
    const stagedTotal = (await db.select().from(stagedAttachments).where(eq(stagedAttachments.ownerId, owner.id)))
      .reduce((sum, r) => sum + r.size + (r.thumbSize ?? 0), 0);
    assert.ok(stagedTotal > bigPng.length, 'the test only proves something if a thumbnail was staged');
    const ids: string[] = [];
    for (let i = 0; i < config.MAX_ATTACHMENTS_PER_MESSAGE - 1; i++) {
      ids.push((((await initAs(cookie, conversationId, config.MAX_ATTACHMENT_BYTES)).json()) as { uploadId: string }).uploadId);
    }
    const over = await initAs(cookie, conversationId, config.MAX_ATTACHMENT_BYTES - stagedTotal + 1);
    assert.equal(over.statusCode, 409, over.body);
    const fits = await initAs(cookie, conversationId, config.MAX_ATTACHMENT_BYTES - stagedTotal);
    assert.equal(fits.statusCode, 201, fits.body);
    ids.push((fits.json() as { uploadId: string }).uploadId);
    await cancelAll(cookie, ids);
  });

  it('caps how many uploads one account keeps open at once', async () => {
    const { conversationId, cookie } = await member();
    const ids: string[] = [];
    for (let i = 0; i < config.MAX_OPEN_UPLOADS_PER_USER; i++) {
      const accepted = await initAs(cookie, conversationId, 10);
      assert.equal(accepted.statusCode, 201, accepted.body);
      ids.push((accepted.json() as { uploadId: string }).uploadId);
    }
    const refused = await initAs(cookie, conversationId, 10);
    assert.equal(refused.statusCode, 409); assert.equal(refused.json().error.code, 'quota_exceeded');
    await cancelAll(cookie, ids);
  });

  it('a reservation that never receives a chunk is given back after the idle window', async () => {
    const { conversationId, cookie } = await member();
    const { uploadId } = (await initAs(cookie, conversationId, config.MAX_ATTACHMENT_BYTES)).json() as { uploadId: string };
    assert.ok(getReservedBytes() >= config.MAX_ATTACHMENT_BYTES);
    const before = getReservedBytes();
    assert.equal(await expireIdleUploads(Date.now() + config.UPLOAD_IDLE_TTL_MS + 1000), 1);
    assert.equal(getReservedBytes(), before - config.MAX_ATTACHMENT_BYTES);
    const chunk = await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/chunk/0`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: Buffer.alloc(config.UPLOAD_CHUNK_BYTES) });
    assert.equal(chunk.statusCode, 404);
  });

  it('repeating complete after success returns the same staged file', async () => {
    const { conversationId, cookie } = await member();
    const id = await stage(cookie, conversationId);
    const again = await app.inject({ method: 'POST', url: `/api/attachments/${id}/complete`, headers: { cookie }, payload: {} });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal((again.json() as { staged: { id: string } }).staged.id, id);
  });

  it('sending publishes the whole batch in the chosen order, in a single message, without duplicating thumbnails', async () => {
    const { owner, conversationId, cookie } = await member();
    const small = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#00ff00' } }).png().toBuffer();
    // finished out of order on purpose: the order sent is what counts
    const [c, a, b] = [await stage(cookie, conversationId, small, 'c.png'), await stage(cookie, conversationId, bigPng, 'a.png'), await stage(cookie, conversationId, small, 'b.png')];
    const clientMessageId = crypto.randomUUID();

    const result = await correlatedSend(owner, conversationId, [a!, b!, c!], 'batch', clientMessageId);
    assert.deepEqual(result.message.attachments.map((x: { name: string }) => x.name), ['a.png', 'b.png', 'c.png']);
    assert.ok(result.message.attachments[0].thumbId, 'the big image gets a thumbnail');

    const history = await getByMessageIds([result.message.msgId]);
    assert.deepEqual(history.get(result.message.msgId)!.map((x) => x.fileName), ['a.png', 'b.png', 'c.png']);
    assert.equal((await db.select().from(stagedAttachments).where(eq(stagedAttachments.ownerId, owner.id))).length, 0);

    const retry = await correlatedSend(owner, conversationId, [a!, b!, c!], 'batch', clientMessageId);
    assert.equal(retry.message.msgId, result.message.msgId);
    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, conversationId))).length, 1);
  });

  it('a file staged by another account cannot be published; nothing changes and the key stays free', async () => {
    const victim = await member();
    const victimFile = await stage(victim.cookie, victim.conversationId);
    const attacker = await makeUser('st');
    await db.insert(serverMembers).values({ serverId: victim.serverId, userId: attacker.id });
    invalidateAllServers();
    const clientMessageId = crypto.randomUUID();

    const result = await correlatedSend(attacker, victim.conversationId, [victimFile], '', clientMessageId);
    assert.equal(result.error.code, 'attachments_unavailable');
    assert.equal((await db.select().from(messages).where(eq(messages.conversationId, victim.conversationId))).length, 0);
    assert.equal((await db.select().from(stagedAttachments).where(eq(stagedAttachments.id, victimFile))).length, 1);
    assert.equal((await db.select().from(messageSendOperations).where(eq(messageSendOperations.clientMessageId, clientMessageId))).length, 0);
  });

  it('a file staged for another conversation does not enter this one', async () => {
    const { owner, conversationId, cookie } = await member();
    const otherConversation = (await makeServerWithMembers(owner.id, [])).textChannelId;
    const id = await stage(cookie, otherConversation);
    const result = await correlatedSend(owner, conversationId, [id]);
    assert.equal(result.error.code, 'attachments_unavailable');
  });

  it('discarding removes the record and the file; expired ones get swept', async () => {
    const { owner, conversationId, cookie } = await member();
    const kept = await stage(cookie, conversationId);
    const dropped = await stage(cookie, conversationId);

    const cancel = await app.inject({ method: 'DELETE', url: `/api/attachments/${dropped}`, headers: { cookie } });
    assert.equal(cancel.statusCode, 200);
    assert.equal(fs.existsSync(path.join(uploadDir, dropped)), false);
    assert.equal((await db.select().from(stagedAttachments).where(eq(stagedAttachments.id, dropped))).length, 0);

    await sweepExpiredStaged(Date.now() + STAGED_TTL_MS + 1000);
    assert.equal((await db.select().from(stagedAttachments).where(eq(stagedAttachments.ownerId, owner.id))).length, 0);
    assert.equal(fs.existsSync(path.join(uploadDir, kept)), false);
  });

  it('thumbnails do not count toward the limit: 4 big images publish together, a 5th id is refused before publishing', async () => {
    const { owner, conversationId, cookie } = await member();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await stage(cookie, conversationId, bigPng, `f${i}.png`))!);

    const ok = await correlatedSend(owner, conversationId, ids, 'four');
    const rows = await db.select().from(attachmentsTable).where(eq(attachmentsTable.messageId, ok.message.msgId));
    assert.equal(rows.filter((r) => !r.isThumbnail).length, 4);
    assert.ok(rows.some((r) => r.isThumbnail), 'the test only proves something if thumbnails were generated');

    const fifthId = await stage(cookie, conversationId, bigPng, 'f4.png');
    const refused = await correlatedSend(owner, conversationId, [...ids, fifthId!], 'five');
    assert.equal(refused.error.code, 'invalid_message');
    // the 5th file is still staged, untouched — the send never got that far
    assert.equal((await db.select().from(stagedAttachments).where(eq(stagedAttachments.id, fifthId!))).length, 1);
  });

  it('replying with an attachment keeps the reference to the replied-to message', async () => {
    const { owner, conversationId, cookie } = await member();
    const [original] = await db.insert(messages).values({ conversationId, authorId: owner.id, text: 'original message' }).returning();
    const id = await stage(cookie, conversationId);

    const { socket, sent, participant } = joinNew(owner);
    let result: any;
    try {
      await chatHandlers.chat!(socket, { conversationId, text: 'look at this', replyTo: original!.id, requestId: 'r', clientMessageId: crypto.randomUUID(), attachmentIds: [id] });
      result = sent.find((s) => s.event === 'chat-send-result')!.payload;
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal(result.message.replyTo?.msgId, original!.id);
    assert.equal(result.message.replyTo?.text, 'original message');
    const [row] = await db.select({ replyTo: messages.replyTo }).from(messages).where(eq(messages.id, result.message.msgId));
    assert.equal((row!.replyTo as { msgId: number }).msgId, original!.id);
  });

  it('a reply to a message from another conversation is dropped, without failing the send with an attachment', async () => {
    const { owner, conversationId, cookie } = await member();
    const otherConversationId = (await makeServerWithMembers(owner.id, [])).textChannelId;
    const [elsewhere] = await db.insert(messages).values({ conversationId: otherConversationId, authorId: owner.id, text: 'another conversation' }).returning();
    const id = await stage(cookie, conversationId);

    const { socket, sent, participant } = joinNew(owner);
    let result: any;
    try {
      await chatHandlers.chat!(socket, { conversationId, text: '', replyTo: elsewhere!.id, requestId: 'r', clientMessageId: crypto.randomUUID(), attachmentIds: [id] });
      result = sent.find((s) => s.event === 'chat-send-result')!.payload;
    } finally {
      cleanupParticipant(participant);
    }
    assert.equal(result.message.replyTo, undefined);
    const [row] = await db.select({ replyTo: messages.replyTo, conversationId: messages.conversationId }).from(messages).where(eq(messages.id, result.message.msgId));
    assert.equal(row!.conversationId, conversationId);
    assert.equal(row!.replyTo, null);
  });
});

describe('media dimensions (real Postgres)', () => {
  async function stageBuffer(cookie: string, conversationId: string, buffer: Buffer, fileName: string, mimeType: string) {
    const init = await app.inject({ method: 'POST', url: '/api/attachments/init', headers: { cookie }, payload: { conversationId, fileName, mimeType, totalSize: buffer.length } });
    const { uploadId } = init.json() as { uploadId: string };
    await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/chunk/0`, headers: { cookie, 'content-type': 'application/octet-stream' }, payload: buffer });
    const complete = await app.inject({ method: 'POST', url: `/api/attachments/${uploadId}/complete`, headers: { cookie }, payload: {} });
    return (complete.json() as { staged: { id: string; width?: number; height?: number; placeholder?: string; thumbId?: string } }).staged;
  }

  it('a staged image reports width/height and so does the published message', async () => {
    const owner = await makeUser('dm');
    const conversationId = (await makeServerWithMembers(owner.id, [])).textChannelId;
    const cookie = await sessionFor(owner.id);
    const staged = await stageBuffer(cookie, conversationId, bigPng, 'landscape.png', 'image/png');
    assert.deepEqual([staged.width, staged.height], [1200, 900]);
    assert.ok(staged.placeholder && staged.placeholder.length < 80, 'a staged image carries a compact placeholder');

    const { socket, sent, participant } = joinNew(owner);
    try {
      await chatHandlers.chat!(socket, { conversationId, text: '', requestId: 'r', clientMessageId: crypto.randomUUID(), attachmentIds: [staged.id] });
    } finally {
      cleanupParticipant(participant);
    }
    const result = sent.find((s) => s.event === 'chat-send-result')!.payload;
    assert.deepEqual([result.message.attachments[0].width, result.message.attachments[0].height], [1200, 900]);
    const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, staged.id));
    assert.deepEqual([row!.width, row!.height], [1200, 900]);
    assert.equal(result.message.attachments[0].placeholder, staged.placeholder);
    assert.equal(row!.placeholder, staged.placeholder);
  });

  it('photo rotated by EXIF: display and thumbnail dimensions come out portrait', async () => {
    const owner = await makeUser('dm');
    const conversationId = (await makeServerWithMembers(owner.id, [])).textChannelId;
    const cookie = await sessionFor(owner.id);
    // stored landscape, displayed portrait (orientation 6 = rotate 90°)
    const rotated = await sharp({ create: { width: 1200, height: 900, channels: 3, background: '#aa3300' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const staged = await stageBuffer(cookie, conversationId, rotated, 'phone.jpg', 'image/jpeg');
    assert.deepEqual([staged.width, staged.height], [900, 1200]);
    const thumb = await sharp(path.join(uploadDir, staged.thumbId!)).metadata();
    assert.ok(thumb.height! > thumb.width!, `thumbnail should be portrait, got ${thumb.width}x${thumb.height}`);
  });

  it('a file that is not an image does not invent dimensions', async () => {
    const owner = await makeUser('dm');
    const conversationId = (await makeServerWithMembers(owner.id, [])).textChannelId;
    const staged = await stageBuffer(await sessionFor(owner.id), conversationId, Buffer.from('%PDF-1.4 x'), 'doc.pdf', 'application/pdf');
    assert.equal(staged.width, undefined);
    assert.equal(staged.placeholder, undefined);
  });
});

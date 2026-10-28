import './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { attachments, messages } from '../../src/db/schema.js';
import { handlers } from '../../src/modules/messages/messages.js';
import { filePathFor } from '../../src/modules/attachments/attachmentStorage.js';
import { cleanupParticipant, db, joinNew, makeGroupWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

type Sent = { event: string; payload: any }[];
const resultOf = (sent: Sent, requestId: string) => sent.find((s) => s.event === 'chat-action-result' && s.payload.requestId === requestId)?.payload;
const editedBroadcasts = (sent: Sent) => sent.filter((s) => s.event === 'chat-edited').map((s) => s.payload.message);

async function message(conversationId: string, authorId: string, text: string, extra: Partial<typeof messages.$inferInsert> = {}): Promise<number> {
  const [row] = await db.insert(messages).values({ conversationId, authorId, text, ...extra }).returning({ id: messages.id });
  return row!.id;
}

/** A stored attachment with its file on disk (and a thumbnail when asked), as an upload leaves it. */
async function attach(messageId: number, withThumb = false): Promise<{ id: string; thumbId: string | null }> {
  const id = crypto.randomUUID().replace(/-/g, '');
  const thumbId = withThumb ? crypto.randomUUID().replace(/-/g, '') : null;
  if (thumbId) {
    await db.insert(attachments).values({ id: thumbId, messageId, fileName: 'thumb', mimeType: 'image/webp', size: 1, isThumbnail: true });
    fs.writeFileSync(filePathFor(thumbId), 'x');
  }
  await db.insert(attachments).values({ id, messageId, fileName: 'foto.png', mimeType: 'image/png', size: 1, thumbId });
  fs.writeFileSync(filePathFor(id), 'x');
  return { id, thumbId };
}

async function withAuthor<T>(fn: (ctx: { socket: any; sent: Sent; conversationId: string; userId: string; otherId: string }) => Promise<T>): Promise<T> {
  const author = await makeUser('rm'); const other = await makeUser('ot');
  const conversationId = await makeGroupWithMembers(author.id, [other.id]);
  const { socket, sent, participant } = joinNew(author);
  try {
    return await fn({ socket, sent, conversationId, userId: author.id, otherId: other.id });
  } finally {
    cleanupParticipant(participant);
  }
}

describe('removing an attachment from a message (real Postgres)', () => {
  it('takes the attachment, its thumbnail and both files away, keeps the text, marks it edited, and tells the conversation', () => withAuthor(async ({ socket, sent, conversationId, userId }) => {
    const msgId = await message(conversationId, userId, 'olha a foto');
    const { id, thumbId } = await attach(msgId, true);

    await handlers['chat-remove-attachment']!(socket, { msgId, attachmentId: id, requestId: 'r1' });

    assert.deepEqual(resultOf(sent, 'r1'), { t: 'chat-action-result', requestId: 'r1' });
    assert.equal((await db.select().from(attachments).where(eq(attachments.messageId, msgId))).length, 0);
    assert.equal(fs.existsSync(filePathFor(id)), false);
    assert.equal(fs.existsSync(filePathFor(thumbId!)), false);
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.equal(row!.text, 'olha a foto');
    assert.ok(row!.editedAt);
    const [edited] = editedBroadcasts(sent);
    assert.equal(edited.msgId, msgId);
    assert.equal(edited.attachments, undefined);
  }));

  it('leaves the other attachments of the message in place', () => withAuthor(async ({ socket, sent, conversationId, userId }) => {
    const msgId = await message(conversationId, userId, '');
    const first = await attach(msgId); const second = await attach(msgId);
    await handlers['chat-remove-attachment']!(socket, { msgId, attachmentId: first.id, requestId: 'r1' });
    assert.equal(resultOf(sent, 'r1').error, undefined);
    assert.deepEqual(editedBroadcasts(sent)[0].attachments.map((a: { id: string }) => a.id), [second.id]);
  }));

  it('refuses to take the only thing a message has: that is deleting it', () => withAuthor(async ({ socket, sent, conversationId, userId }) => {
    const msgId = await message(conversationId, userId, '   ');
    const { id } = await attach(msgId);
    await handlers['chat-remove-attachment']!(socket, { msgId, attachmentId: id, requestId: 'r1' });
    assert.equal(resultOf(sent, 'r1').error.code, 'invalid_message');
    assert.equal((await db.select().from(attachments).where(eq(attachments.id, id))).length, 1);
    assert.equal(fs.existsSync(filePathFor(id)), true);
  }));

  it("only the author removes: someone else's message is refused and untouched", () => withAuthor(async ({ socket, sent, conversationId, otherId }) => {
    const msgId = await message(conversationId, otherId, 'dele');
    const { id } = await attach(msgId);
    await handlers['chat-remove-attachment']!(socket, { msgId, attachmentId: id, requestId: 'r1' });
    assert.equal(resultOf(sent, 'r1').error.code, 'forbidden');
    assert.equal((await db.select().from(attachments).where(eq(attachments.id, id))).length, 1);
  }));

  it('an attachment of another message is not found here', () => withAuthor(async ({ socket, sent, conversationId, userId }) => {
    const msgId = await message(conversationId, userId, 'minha');
    const otherMsg = await message(conversationId, userId, 'outra');
    const { id } = await attach(otherMsg);
    await handlers['chat-remove-attachment']!(socket, { msgId, attachmentId: id, requestId: 'r1' });
    assert.equal(resultOf(sent, 'r1').error.code, 'not_found');
    assert.equal((await db.select().from(attachments).where(eq(attachments.id, id))).length, 1);
  }));
});

describe('removing the card of a link (real Postgres)', () => {
  const preview = (url: string) => ({ url, title: 't', description: '', image: null, siteName: 'site', favicon: null });

  it('keeps the link as text, drops its stored preview, remembers it, and does not mark an edit', () => withAuthor(async ({ socket, sent, conversationId, userId }) => {
    const a = 'https://exemplo.com/a'; const b = 'https://exemplo.com/b';
    const msgId = await message(conversationId, userId, `veja ${a} e ${b}`, { embeds: [preview(a), preview(b)] });

    await handlers['chat-suppress-embed']!(socket, { msgId, url: a, requestId: 'r1' });

    assert.equal(resultOf(sent, 'r1').error, undefined);
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.equal(row!.text, `veja ${a} e ${b}`);
    assert.deepEqual(row!.suppressedEmbeds, [a]);
    assert.deepEqual((row!.embeds as { url: string }[]).map((e) => e.url), [b]);
    assert.equal(row!.editedAt, null);
    const [edited] = editedBroadcasts(sent);
    assert.deepEqual(edited.suppressedEmbeds, [a]);
    assert.deepEqual(edited.embeds.map((e: { url: string }) => e.url), [b]);
  }));

  it('a link that is not in the message is not found', () => withAuthor(async ({ socket, sent, conversationId, userId }) => {
    const msgId = await message(conversationId, userId, 'sem link');
    await handlers['chat-suppress-embed']!(socket, { msgId, url: 'https://exemplo.com/x', requestId: 'r1' });
    assert.equal(resultOf(sent, 'r1').error.code, 'not_found');
  }));

  it("only the author removes a card: someone else's message is refused", () => withAuthor(async ({ socket, sent, conversationId, otherId }) => {
    const url = 'https://exemplo.com/a';
    const msgId = await message(conversationId, otherId, url);
    await handlers['chat-suppress-embed']!(socket, { msgId, url, requestId: 'r1' });
    assert.equal(resultOf(sent, 'r1').error.code, 'forbidden');
    const [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.equal(row!.suppressedEmbeds, null);
  }));

  it('an edit that drops the link forgets that its card was removed; one that keeps it does not', () => withAuthor(async ({ socket, sent, conversationId, userId }) => {
    const url = 'https://exemplo.com/a';
    const msgId = await message(conversationId, userId, `veja ${url}`);
    await handlers['chat-suppress-embed']!(socket, { msgId, url, requestId: 'r1' });

    await handlers['chat-edit']!(socket, { msgId, text: `ainda ${url}`, requestId: 'r2' });
    let [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.deepEqual(row!.suppressedEmbeds, [url]);

    await handlers['chat-edit']!(socket, { msgId, text: 'sem link agora', requestId: 'r3' });
    [row] = await db.select().from(messages).where(eq(messages.id, msgId));
    assert.equal(row!.suppressedEmbeds, null);
    assert.equal(resultOf(sent, 'r3').error, undefined);
  }));
});

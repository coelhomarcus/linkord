import './isolatedUploadDir.js';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import { attachments, messages } from '../../src/db/schema.js';
import { fetchMediaPage, type MediaKind } from '../../src/modules/attachments/media.js';
import { cleanupParticipant, db, joinNew, makeGroupWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

async function message(conversationId: string, authorId: string, text: string): Promise<number> {
  const [row] = await db.insert(messages).values({ conversationId, authorId, text }).returning({ id: messages.id });
  return row!.id;
}

async function attach(messageId: number, fileName: string, mimeType: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '');
  await db.insert(attachments).values({ id, messageId, fileName, mimeType, size: 1 });
  return id;
}

async function withConversation<T>(fn: (ctx: { conversationId: string; userId: string; outsiderId: string }) => Promise<T>): Promise<T> {
  const author = await makeUser('md'); const other = await makeUser('mo'); const outsider = await makeUser('mx');
  const conversationId = await makeGroupWithMembers(author.id, [other.id]);
  const { participant } = joinNew(author);
  try {
    return await fn({ conversationId, userId: author.id, outsiderId: outsider.id });
  } finally {
    cleanupParticipant(participant);
  }
}

const page = (kind: MediaKind, viewerId: string, conversationId: string, q: string | null = null, before: number | null = null, limit = 24) =>
  fetchMediaPage(kind, viewerId, before, limit, conversationId, q);

const namesOf = async (kind: MediaKind, viewerId: string, conversationId: string, q: string | null = null) =>
  ((await page(kind, viewerId, conversationId, q)).items as { attachment: { name: string } }[]).map((i) => i.attachment.name);

describe('the media list by type (real Postgres)', () => {
  it('splits uploads into images, videos, audios and documents by mime', () => withConversation(async ({ conversationId, userId }) => {
    await attach(await message(conversationId, userId, ''), 'foto.png', 'image/png');
    await attach(await message(conversationId, userId, ''), 'filme.mp4', 'video/mp4');
    await attach(await message(conversationId, userId, ''), 'som.wav', 'audio/wav');
    await attach(await message(conversationId, userId, ''), 'texto.pdf', 'application/pdf');
    await attach(await message(conversationId, userId, ''), 'raro.svg', 'image/svg+xml');

    assert.deepEqual(await namesOf('images', userId, conversationId), ['foto.png']);
    assert.deepEqual(await namesOf('videos', userId, conversationId), ['filme.mp4']);
    assert.deepEqual(await namesOf('audios', userId, conversationId), ['som.wav']);
    assert.deepEqual(await namesOf('documents', userId, conversationId), ['raro.svg', 'texto.pdf']);
    assert.equal((await namesOf('uploads', userId, conversationId)).length, 5);
  }));

  it('narrows by file name, case-insensitively, without treating % and _ as wildcards', () => withConversation(async ({ conversationId, userId }) => {
    await attach(await message(conversationId, userId, ''), 'Relatório Final.pdf', 'application/pdf');
    await attach(await message(conversationId, userId, ''), 'notas.pdf', 'application/pdf');
    await attach(await message(conversationId, userId, ''), '100%_ok.pdf', 'application/pdf');

    assert.deepEqual(await namesOf('documents', userId, conversationId, 'relat'), ['Relatório Final.pdf']);
    assert.deepEqual(await namesOf('documents', userId, conversationId, '%_'), ['100%_ok.pdf']);
    assert.deepEqual(await namesOf('documents', userId, conversationId, 'inexistente'), []);
  }));

  it('pages a type with a cursor, newest first', () => withConversation(async ({ conversationId, userId }) => {
    for (const name of ['a.png', 'b.png', 'c.png']) await attach(await message(conversationId, userId, ''), name, 'image/png');
    const first = await page('images', userId, conversationId, null, null, 2);
    assert.deepEqual((first.items as { attachment: { name: string } }[]).map((i) => i.attachment.name), ['c.png', 'b.png']);
    const second = await page('images', userId, conversationId, null, first.nextBefore, 2);
    assert.deepEqual((second.items as { attachment: { name: string } }[]).map((i) => i.attachment.name), ['a.png']);
    assert.equal(second.nextBefore, null);
  }));

  it('lists KLIPY GIF messages under gifs and keeps them out of links', () => withConversation(async ({ conversationId, userId }) => {
    const gif = 'https://static.klipy.com/ii/abc/def.gif';
    await message(conversationId, userId, gif);
    await message(conversationId, userId, `  ${gif.replace('static', 'static2')}  `);
    await message(conversationId, userId, `olha isso ${gif}`);
    await message(conversationId, userId, 'veja https://exemplo.com/artigo');

    const gifs = (await page('gifs', userId, conversationId)).items as { embed: { kind: string; url: string } }[];
    assert.deepEqual(gifs.map((g) => g.embed.url), ['https://static2.klipy.com/ii/abc/def.gif', gif]);
    assert.ok(gifs.every((g) => g.embed.kind === 'image'));

    const links = (await page('embeds', userId, conversationId)).items as { embed: { url: string } }[];
    assert.deepEqual(links.map((l) => l.embed.url), ['https://exemplo.com/artigo', gif]);
  }));

  it('narrows links by their text', () => withConversation(async ({ conversationId, userId }) => {
    await message(conversationId, userId, 'https://exemplo.com/receitas');
    await message(conversationId, userId, 'https://exemplo.com/noticias');
    const links = (await page('embeds', userId, conversationId, 'receitas')).items as { embed: { url: string } }[];
    assert.deepEqual(links.map((l) => l.embed.url), ['https://exemplo.com/receitas']);
  }));

  it('shows nothing of a conversation the viewer is not in, for any type', () => withConversation(async ({ conversationId, userId, outsiderId }) => {
    await attach(await message(conversationId, userId, ''), 'foto.png', 'image/png');
    await message(conversationId, userId, 'https://static.klipy.com/a.gif');
    for (const kind of ['uploads', 'images', 'documents', 'gifs', 'embeds'] as const) {
      assert.deepEqual((await page(kind, outsiderId, conversationId)).items, [], kind);
    }
  }));
});

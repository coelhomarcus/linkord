import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo, LookupFunction } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { messages } from '../../src/db/schema.js';
import { backfillEmbeds, unfurlMessage } from '../../src/modules/messages/messageEmbeds.js';
import { handlers as chatHandlers } from '../../src/modules/messages/messages.js';
import { cleanupParticipant, db, joinNew, makeGroupWithMembers, makeUser, pool } from './helpers.js';

// the real lookup refuses loopback (SSRF guard); only these tests reach the local page server
const allowLoopback: LookupFunction = (_host, options, callback) => {
  if (options.all) return (callback as unknown as (e: null, a: { address: string; family: number }[]) => void)(null, [{ address: '127.0.0.1', family: 4 }]);
  callback(null, '127.0.0.1', 4);
};

let server: http.Server;
let base: string;
before(async () => {
  const png = await sharp({ create: { width: 1200, height: 630, channels: 3, background: '#335' } }).png().toBuffer();
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/page')) {
      res.setHeader('content-type', 'text/html');
      return void res.end(`<html><head><title>Página ${req.url}</title><meta property="og:image" content="/og.png"></head></html>`);
    }
    if (req.url === '/og.png') { res.setHeader('content-type', 'image/png'); return void res.end(png); }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(async () => { server.close(); server.closeAllConnections(); await pool.end(); });

async function seed(text: string) {
  const owner = await makeUser('emb');
  const conversationId = await makeGroupWithMembers(owner.id, []);
  const [row] = await db.insert(messages).values({ conversationId, authorId: owner.id, text }).returning();
  return { owner, conversationId, row: row! };
}

describe('message embeds (real Postgres)', () => {
  it('stores the preview with the message and tells the conversation', async () => {
    const { owner, conversationId, row } = await seed(`olha ${base}/page-a`);
    const { sent, participant } = joinNew(owner);
    try {
      await unfurlMessage(row, owner.id, allowLoopback);
    } finally { cleanupParticipant(participant); }

    const [stored] = await db.select().from(messages).where(eq(messages.id, row.id));
    const [embed] = stored!.embeds as { url: string; title: string; imageWidth: number; imageHeight: number }[];
    assert.equal(embed!.url, `${base}/page-a`);
    assert.equal(embed!.title, 'Página /page-a');
    assert.deepEqual([embed!.imageWidth, embed!.imageHeight], [1200, 630]);
    const event = sent.find((s) => s.event === 'chat-embeds')!.payload;
    assert.deepEqual([event.conversationId, event.msgId, event.embeds[0].title], [conversationId, row.id, 'Página /page-a']);
  });

  it('one preview per card the client draws: up to three, not the ones in code or <suppressed>', async () => {
    const { owner, row } = await seed(`${base}/page-1 \`${base}/page-code\` <${base}/page-quiet> ${base}/page-2 ${base}/page-3 ${base}/page-4`);
    await unfurlMessage(row, owner.id, allowLoopback);
    const [stored] = await db.select().from(messages).where(eq(messages.id, row.id));
    assert.deepEqual((stored!.embeds as { url: string }[]).map((e) => e.url), [`${base}/page-1`, `${base}/page-2`, `${base}/page-3`]);
  });

  it('does not store it if the message was edited meanwhile', async () => {
    const { owner, row } = await seed(`olha ${base}/page-b`);
    await db.update(messages).set({ text: 'sem link agora' }).where(eq(messages.id, row.id));
    await unfurlMessage(row, owner.id, allowLoopback);
    const [stored] = await db.select().from(messages).where(eq(messages.id, row.id));
    assert.equal(stored!.embeds, null);
  });

  it('history carries the stored preview, and hides one left behind by an edit to another link', async () => {
    const { owner, conversationId, row } = await seed(`olha ${base}/page-c`);
    await unfurlMessage(row, owner.id, allowLoopback);
    const [second] = await db.insert(messages).values({ conversationId, authorId: owner.id, text: `antes ${base}/page-d` }).returning();
    await unfurlMessage(second!, owner.id, allowLoopback);
    await db.update(messages).set({ text: `agora ${base}/page-other` }).where(eq(messages.id, second!.id));

    const { socket, sent, participant } = joinNew(owner);
    try {
      await chatHandlers['conversation-open']!(socket, { conversationId });
    } finally { cleanupParticipant(participant); }
    const history = sent.find((s) => s.event === 'conversation-history')!.payload.messages as { msgId: number; embeds?: { title: string }[] }[];
    assert.equal(history.find((m) => m.msgId === row.id)!.embeds![0]!.title, 'Página /page-c');
    assert.equal(history.find((m) => m.msgId === second!.id)!.embeds, undefined);
  });

  it('fills in messages from before previews were stored, and skips video and audio links', async () => {
    const { owner, conversationId, row } = await seed(`antigo ${base}/page-e`);
    const [clip] = await db.insert(messages).values({ conversationId, authorId: owner.id, text: `${base}/clip.mp4` }).returning();
    await backfillEmbeds([row, clip!], owner.id, allowLoopback);
    const stored = await db.select().from(messages).where(eq(messages.conversationId, conversationId));
    assert.equal((stored.find((m) => m.id === row.id)!.embeds as { title: string }[])[0]!.title, 'Página /page-e');
    assert.equal(stored.find((m) => m.id === clip!.id)!.embeds, null);
  });
});

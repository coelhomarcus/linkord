import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { messages } from '../../src/db/schema.js';
import { handlers } from '../../src/modules/messages/messages.js';
import { cleanupParticipant, db, joinNew, makeServerWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

interface SearchResult { msgId: number; snippet: string }

async function withChannel<T>(texts: string[], fn: (search: (query: string) => Promise<SearchResult[]>, ids: number[]) => Promise<T>): Promise<T> {
  const owner = await makeUser('ms');
  const conversationId = (await makeServerWithMembers(owner.id, [])).textChannelId;
  const ids: number[] = [];
  for (const text of texts) {
    const [row] = await db.insert(messages).values({ conversationId, authorId: owner.id, text }).returning({ id: messages.id });
    ids.push(row!.id);
  }
  const { socket, sent, participant } = joinNew(owner);
  try {
    return await fn(async (query) => {
      sent.length = 0;
      await handlers['message-search']!(socket, { query, conversationId });
      const reply = sent.find((s) => s.event === 'message-search-results');
      assert.ok(reply, `no results message for "${query}"`);
      return reply.payload.results;
    }, ids);
  } finally {
    cleanupParticipant(participant);
  }
}

const highlighted = (snippet: string) => [...snippet.matchAll(/(.*?)/g)].map((m) => m[1]);

describe('message search (real Postgres)', () => {
  it('finds an English word by its stem and highlights it', () => withChannel(
    ['I am running late for the meeting', 'nada a ver'],
    async (search, [english]) => {
      const results = await search('run');
      assert.deepEqual(results.map((r) => r.msgId), [english]);
      assert.deepEqual(highlighted(results[0]!.snippet), ['running']);
    },
  ));

  it('ignores accents on either side', () => withChannel(
    ['A reunião foi remarcada', 'cafe com pao de queijo'],
    async (search, [meeting, coffee]) => {
      const unaccentedQuery = await search('reuniao');
      assert.deepEqual(unaccentedQuery.map((r) => r.msgId), [meeting]);
      assert.deepEqual(highlighted(unaccentedQuery[0]!.snippet), ['reunião']);
      assert.deepEqual((await search('café')).map((r) => r.msgId), [coffee]);
      assert.deepEqual((await search('PÃO')).map((r) => r.msgId), [coffee]);
    },
  ));

  it('still matches Portuguese words by their stem', () => withChannel(
    ['mensagens enviadas com sucesso'],
    async (search, [sent]) => {
      const results = await search('enviada');
      assert.deepEqual(results.map((r) => r.msgId), [sent]);
      assert.deepEqual(highlighted(results[0]!.snippet), ['enviadas']);
    },
  ));

  it('keeps web search syntax: exclusion and quoted phrases', () => withChannel(
    ['reunião amanhã cedo', 'reunião cancelada'],
    async (search, [tomorrow, cancelled]) => {
      assert.deepEqual((await search('reuniao -cancelada')).map((r) => r.msgId), [tomorrow]);
      assert.deepEqual((await search('"reuniao cancelada"')).map((r) => r.msgId), [cancelled]);
    },
  ));
});

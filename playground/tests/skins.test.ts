import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { handleSkinGet, handleSkinSet, memorySkinStore, setSkinStore } from '../src/skins.js';
import { admit, clearRoster, type Player } from '../src/roster.js';
import { skinPng } from './fixtures.js';

function player(id: string, userId: string, conversationId: string): Player {
  const p: Player = { id, userId, conversationId, expiresAt: Date.now() + 60_000, socket: { connected: true, emit: () => {}, disconnect: () => {} } };
  admit(p);
  return p;
}

const ask = async (fn: (ack: (answer: Record<string, unknown>) => void) => Promise<void>) => {
  let answer: Record<string, unknown> | null = null;
  await fn((given) => { answer = given; });
  return answer;
};

describe('skins', () => {
  let store: ReturnType<typeof memorySkinStore>;

  beforeEach(() => {
    store = memorySkinStore();
    setSkinStore(store);
  });

  afterEach(() => clearRoster());

  test('saves your own, and back to the default with null', async () => {
    const me = player('c1', 'ana', 'play-1');
    assert.deepEqual(await ask((ack) => handleSkinSet(me, { skin: skinPng() }, ack)), { skin: skinPng() });
    assert.equal(await store.get('ana'), skinPng());
    assert.deepEqual(await ask((ack) => handleSkinSet(me, { skin: null }, ack)), { skin: null });
    assert.equal(await store.get('ana'), null);
  });

  test('refuses what is not a skin', async () => {
    const me = player('c1', 'ana', 'play-1');
    for (const skin of [undefined, '', 'abc', skinPng(48), 42]) {
      assert.deepEqual(await ask((ack) => handleSkinSet(me, { skin }, ack)), { error: 'invalid' });
    }
    assert.equal(store.rows.size, 0);
  });

  test('reads your own and that of anyone in your call, nobody else\'s', async () => {
    await store.set('bia', skinPng());
    await store.set('caio', skinPng(32));
    const me = player('c1', 'ana', 'play-1');
    player('c2', 'bia', 'play-1');
    player('c3', 'caio', 'play-2');
    assert.deepEqual(await ask((ack) => handleSkinGet(me, { userId: 'ana' }, ack)), { skin: null });
    assert.deepEqual(await ask((ack) => handleSkinGet(me, { userId: 'bia' }, ack)), { skin: skinPng() });
    assert.deepEqual(await ask((ack) => handleSkinGet(me, { userId: 'caio' }, ack)), { error: 'not-here' });
    assert.deepEqual(await ask((ack) => handleSkinGet(me, { userId: 'nobody' }, ack)), { error: 'not-here' });
  });

  test('an import keeps a skin saved here since', async () => {
    await store.set('ana', skinPng());
    const old = new Date(Date.now() - 60_000);
    await store.importNewer([{ userId: 'ana', png: skinPng(32), updatedAt: old }, { userId: 'bia', png: skinPng(32), updatedAt: old }]);
    assert.equal(await store.get('ana'), skinPng());
    assert.equal(await store.get('bia'), skinPng(32));
  });
});


import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEmojiName } from '../../../src/modules/emojis/serverEmojis.js';

describe('parseEmojiName', () => {
  it('accepts lowercase letters, numbers and _, 2 to 32 long', () => {
    assert.equal(parseEmojiName('party_parrot2'), 'party_parrot2');
    assert.equal(parseEmojiName('  ok  '), 'ok');
    assert.equal(parseEmojiName('a'.repeat(32)), 'a'.repeat(32));
  });

  it('refuses rather than quietly changing a name', () => {
    for (const bad of ['a', 'a'.repeat(33), 'Party', 'with space', 'acentuação', 'dash-name', '', null, 42]) {
      assert.equal(parseEmojiName(bad), null, String(bad));
    }
  });
});

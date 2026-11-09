import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { emojiUsageKeys } from '../../../src/modules/emojis/expressionUsage.js';

describe('emojiUsageKeys', () => {
  it('lists each emoji of a message once, in order', () => {
    assert.deepEqual(emojiUsageKeys('oi 😂 tudo bem? 👍🏽😂 ❤️'), ['😂', '👍🏽', '❤️']);
  });

  it('keeps sequences whole', () => {
    assert.deepEqual(emojiUsageKeys('👨‍👩‍👧 🇧🇷'), ['👨‍👩‍👧', '🇧🇷']);
  });

  it('finds nothing in plain text', () => {
    assert.deepEqual(emojiUsageKeys('nada aqui, só texto 123'), []);
  });

  it('caps how many one message counts', () => {
    const many = ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '🫠', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚', '😙'];
    assert.equal(emojiUsageKeys(many.join(' ')).length, 20);
  });
});

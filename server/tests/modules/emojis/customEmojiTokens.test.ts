import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { customEmojiIds, customEmojisAsText, customReactionId, rewriteCustomEmojis } from '../../../src/modules/emojis/customEmojiTokens.js';
import { emojiUsageKeys } from '../../../src/modules/emojis/expressionUsage.js';

const A = 'a'.repeat(32);
const B = 'b'.repeat(32);

describe('custom emoji tokens', () => {
  it('finds the ids of the tokens outside code, once each', () => {
    assert.deepEqual(customEmojiIds(`oi <:wave:${A}> <a:party:${B}> <:wave:${A}>`), [A, B]);
    assert.deepEqual(customEmojiIds(`\`<:wave:${A}>\` and \n\`\`\`\n<:x:${B}>\n\`\`\``), []);
  });

  it('ignores what only looks like a token', () => {
    assert.deepEqual(customEmojiIds(`<:Wave:${A}> <:w:${A}> <:wave:${A.slice(1)}> <b:wave:${A}>`), []);
  });

  it('keeps usable tokens with their current name and turns the rest into text', () => {
    const usable = new Map([[A, { id: A, name: 'renamed', animated: true }]]);
    assert.equal(rewriteCustomEmojis(`<:wave:${A}> e <:nope:${B}>`, usable), `<a:renamed:${A}> e :nope:`);
  });

  it('leaves tokens inside code exactly as typed', () => {
    assert.equal(rewriteCustomEmojis(`\`<:nope:${B}>\` <:nope:${B}>`, new Map()), `\`<:nope:${B}>\` :nope:`);
  });

  it('reads tokens as their names for plain-text places', () => {
    assert.equal(customEmojisAsText(`gg <a:party:${B}>!`), 'gg :party:!');
  });

  it('recognizes a custom reaction key', () => {
    assert.equal(customReactionId(`custom:${A}`), A);
    assert.equal(customReactionId('👍'), null);
    assert.equal(customReactionId(`custom:${A}x`), null);
  });

  it('counts server emojis as custom:<id> uses', () => {
    assert.deepEqual(emojiUsageKeys(`<:wave:${A}> 😂`), [`custom:${A}`, '😂']);
  });
});

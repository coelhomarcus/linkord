import { describe, expect, it } from 'vitest';
import {
  customEmojisAsText, customReactionId, customReactionKey, emojisByName, encodeCustomEmojis, tokensByName,
} from '@/features/emoji/customEmojiText';
import type { CustomEmoji } from '@/features/emoji/myEmojis';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const wave: CustomEmoji = { id: A, name: 'wave', animated: false, serverId: 's1' };
const otherWave: CustomEmoji = { id: B, name: 'wave', animated: true, serverId: 's2' };
const groups = [{ serverId: 's1', emojis: [wave] }, { serverId: 's2', emojis: [otherWave] }];

describe('encodeCustomEmojis', () => {
  const byName = emojisByName(groups);

  it('sends a :name: of the account as its token', () => {
    expect(encodeCustomEmojis('oi :wave: tudo', byName)).toBe(`oi <:wave:${A}> tudo`);
  });

  it('picks the second emoji of a shared name with ~2, animated as such', () => {
    expect(encodeCustomEmojis(':wave~2:', byName)).toBe(`<a:wave:${B}>`);
  });

  it('prefers the conversation server\'s emoji for a shared name', () => {
    expect(encodeCustomEmojis(':wave:', emojisByName(groups, 's2'))).toBe(`<a:wave:${B}>`);
  });

  it('leaves unknown names, code and glued text alone', () => {
    expect(encodeCustomEmojis(':nope: `:wave:` a:wave: 10:30', byName)).toBe(':nope: `:wave:` a:wave: 10:30');
  });

  it('keeps an edited message pointing at the emoji it already had', () => {
    const keep = tokensByName(`<a:wave:${B}>`);
    expect(encodeCustomEmojis(':wave:', byName, keep)).toBe(`<a:wave:${B}>`);
  });
});

describe('custom emoji text helpers', () => {
  it('reads tokens as :name: outside code', () => {
    expect(customEmojisAsText(`gg <a:party:${A}> \`<:x:${B}>\``)).toBe(`gg :party: \`<:x:${B}>\``);
  });

  it('round-trips a reaction key', () => {
    expect(customReactionId(customReactionKey(A))).toBe(A);
    expect(customReactionId('👍')).toBeNull();
    expect(customReactionId('custom:nope')).toBeNull();
  });
});

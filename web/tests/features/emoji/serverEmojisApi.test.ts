import { describe, expect, it } from 'vitest';
import { suggestEmojiName } from '@/features/emoji/serverEmojisApi';

describe('suggestEmojiName', () => {
  it('turns a file name into a valid emoji name', () => {
    expect(suggestEmojiName('Party Parrot.gif')).toBe('party_parrot');
    expect(suggestEmojiName('Coração (2).PNG')).toBe('coracao_2');
  });

  it('gives nothing when too little is left', () => {
    expect(suggestEmojiName('?.png')).toBe('');
  });

  it('caps the length', () => {
    expect(suggestEmojiName(`${'a'.repeat(40)}.webp`)).toHaveLength(32);
  });
});

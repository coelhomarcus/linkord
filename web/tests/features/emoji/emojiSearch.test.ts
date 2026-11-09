import { describe, expect, it } from 'vitest';
import { suggestShortcodes, withSkinTone } from '@/features/emoji/emojiSearch';
import { testEmojiData } from '@tests/fixtures/emojiDataFixture';

const shortcodes = (query: string, frequent: string[] = [], tone = 0) =>
  suggestShortcodes(query, testEmojiData, frequent, 8, tone).map((s) => s.shortcode);

describe('suggestShortcodes', () => {
  it('puts names starting with the query before names containing it', () => {
    expect(shortcodes('lau')).toEqual(['laughing', 'rolling_on_the_floor_laughing']);
  });

  it('puts an exact name first', () => {
    expect(shortcodes('dog')).toEqual(['dog', 'hotdog']);
  });

  it('ranks what the account uses most first within the same tier', () => {
    expect(shortcodes('ro')).toEqual(['rofl']);
    expect(shortcodes('o')).toEqual(['joy', 'rofl', 'dog', 'hotdog']);
    expect(shortcodes('o', ['🌭', '🐶'])).toEqual(['hotdog', 'dog', 'joy', 'rofl']);
  });

  it('counts a toned variant as its base emoji', () => {
    expect(shortcodes('w', ['👋🏽'])[0]).toBe('wave');
  });

  it('applies the chosen skin tone', () => {
    expect(suggestShortcodes('wave', testEmojiData, [], 8, 3)[0]?.emoji).toBe('👋🏽');
    expect(withSkinTone(testEmojiData.byShortcode.get('joy')!, 3)).toBe('😂');
  });

  it('respects the limit and ignores an empty query', () => {
    expect(suggestShortcodes('', testEmojiData, [])).toEqual([]);
    expect(suggestShortcodes('a', testEmojiData, [], 2)).toHaveLength(2);
  });
});

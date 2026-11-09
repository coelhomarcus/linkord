import { buildEmojiData, primeEmojiData } from '@/features/emoji/emojiData';

const SKINS_WAVE = ['👋🏻', '👋🏼', '👋🏽', '👋🏾', '👋🏿'];

/** A handful of real entries, in the dataset's order, so nothing fetches. */
export const testEmojiData = buildEmojiData([
  ['😀', 'grinning face', 0, ['grinning'], ['happy']],
  ['😆', 'grinning squinting face', 0, ['laughing', 'satisfied'], ['laugh']],
  ['😂', 'face with tears of joy', 0, ['joy'], ['laugh', 'tears']],
  ['🤣', 'rolling on the floor laughing', 0, ['rofl', 'rolling_on_the_floor_laughing'], ['laugh']],
  ['👋', 'waving hand', 1, ['wave'], ['hello'], SKINS_WAVE],
  ['🐶', 'dog face', 3, ['dog'], ['pet']],
  ['🌭', 'hot dog', 4, ['hotdog'], ['food']],
]);

export function primeTestEmojiData(): void {
  primeEmojiData(testEmojiData, 'pt');
  primeEmojiData(testEmojiData, 'en');
}

import { describe, expect, it } from 'vitest';
import { completeClosedShortcode, getEmojiQuery, insertAtQuery } from '@/features/chat/emojiAutocomplete';

describe('getEmojiQuery', () => {
  it('needs two characters after the colon', () => {
    expect(getEmojiQuery(':l', 2)).toBeNull();
    expect(getEmojiQuery(':la', 3)).toEqual({ start: 0, query: 'la' });
  });

  it('starts only at the start of a word', () => {
    expect(getEmojiQuery('oi :lau', 7)).toEqual({ start: 3, query: 'lau' });
    expect(getEmojiQuery('(:lau', 5)).toEqual({ start: 1, query: 'lau' });
    expect(getEmojiQuery('às 10:30', 8)).toBeNull();
    expect(getEmojiQuery('http://x', 6)).toBeNull();
  });

  it('follows the caret, not the end of the text', () => {
    expect(getEmojiQuery(':joy and more', 4)).toEqual({ start: 0, query: 'joy' });
    expect(getEmojiQuery(':joy and more', 13)).toBeNull();
  });

  it('closes once the name is closed or a space follows', () => {
    expect(getEmojiQuery(':joy:', 5)).toBeNull();
    expect(getEmojiQuery(':joy ', 5)).toBeNull();
  });
});

describe('insertAtQuery', () => {
  it('replaces the query and adds a space', () => {
    expect(insertAtQuery('oi :lau', { start: 3, query: 'lau' }, '😆')).toEqual({ text: 'oi 😆 ', caret: 6 });
  });

  it('does not double a space that is already there', () => {
    expect(insertAtQuery(':lau tudo', { start: 0, query: 'lau' }, '😆')).toEqual({ text: '😆 tudo', caret: 2 });
  });
});

describe('completeClosedShortcode', () => {
  const resolve = (name: string) => (name === 'joy' ? '😂' : null);

  it('converts a known name just closed at the caret', () => {
    expect(completeClosedShortcode('haha :joy:', 10, resolve)).toEqual({ text: 'haha 😂', caret: 7 });
  });

  it('ignores case', () => {
    expect(completeClosedShortcode(':JOY:', 5, resolve)).toEqual({ text: '😂', caret: 2 });
  });

  it('leaves unknown names and mid-word colons alone', () => {
    expect(completeClosedShortcode(':nope:', 6, resolve)).toBeNull();
    expect(completeClosedShortcode('a:joy:', 6, resolve)).toBeNull();
  });
});

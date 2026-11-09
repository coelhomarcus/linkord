import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { splitEmoji, twemojiUrls } from '@/features/emoji/twemoji';
import { Emoji, EmojiText } from '@/features/emoji/Emoji';

const base = __TWEMOJI_PATH__;

describe('twemojiUrls', () => {
  it('names the file by code point, without FE0F', () => {
    expect(twemojiUrls('😀')).toEqual([`${base}1f600.svg`]);
    expect(twemojiUrls('❤️')).toEqual([`${base}2764.svg`]);
    expect(twemojiUrls('🇧🇷')).toEqual([`${base}1f1e7-1f1f7.svg`]);
  });

  it('keeps FE0F in a ZWJ sequence, then tries without it', () => {
    expect(twemojiUrls('🏳️‍🌈')).toEqual([`${base}1f3f3-fe0f-200d-1f308.svg`, `${base}1f3f3-200d-1f308.svg`]);
  });
});

describe('splitEmoji', () => {
  it('cuts text into plain runs and whole emojis, sequences and skin tones included', () => {
    expect(splitEmoji('oi 👋🏽 família 👨‍👩‍👧!')).toEqual(['oi ', { emoji: '👋🏽' }, ' família ', { emoji: '👨‍👩‍👧' }, '!']);
  });

  it('leaves text without emojis whole, and text-style symbols as text', () => {
    expect(splitEmoji('bom dia')).toEqual(['bom dia']);
    expect(splitEmoji('© 2026')).toEqual(['© 2026']);
  });
});

describe('Emoji', () => {
  it('keeps the real character in the page under the picture', () => {
    render(<Emoji emoji="🎉" />);
    const glyph = screen.getByText('🎉');
    expect(glyph.style.backgroundImage).toBe(`url("${base}1f389.svg")`);
    expect(glyph).toHaveClass('text-transparent');
  });

  it('draws each emoji of a text, so copying it gives the same text back', () => {
    const { container } = render(<p><EmojiText text="valeu 🙏 pessoal" /></p>);
    expect(container.querySelectorAll('[data-emoji]')).toHaveLength(1);
    expect(container.textContent).toBe('valeu 🙏 pessoal');
  });
});

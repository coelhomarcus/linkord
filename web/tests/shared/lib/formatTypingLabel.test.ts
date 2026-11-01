import { describe, expect, it } from 'vitest';
import { formatTypingLabel } from '@/shared/lib/formatTypingLabel';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

describe('formatTypingLabel', () => {
  it('nobody typing returns null', () => {
    expect(formatTypingLabel([])).toBe(null);
  });

  it('one person', () => {
    expect(formatTypingLabel(['Fulano'])).toBe('Fulano está digitando...');
  });

  it('two people', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana'])).toBe('Fulano e Beltrana estão digitando...');
  });

  it('three people: names everyone', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana', 'Ciclano'])).toBe('Fulano, Beltrana e Ciclano estão digitando...');
  });

  it('more than three people: falls back to generic text, without listing names', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana', 'Ciclano', 'Deltrana'])).toBe('Várias pessoas estão digitando...');
    expect(formatTypingLabel(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('Várias pessoas estão digitando...');
  });
});

describe('formatTypingLabel in English', () => {
  useLanguageForTests('en-US');

  it('conjugates and joins the names the English way', () => {
    expect(formatTypingLabel(['Ana'])).toBe('Ana is typing...');
    expect(formatTypingLabel(['Ana', 'Bia'])).toBe('Ana and Bia are typing...');
    expect(formatTypingLabel(['Ana', 'Bia', 'Caio'])).toBe('Ana, Bia, and Caio are typing...');
    expect(formatTypingLabel(['A', 'B', 'C', 'D'])).toBe('Several people are typing...');
  });
});

import { describe, expect, it } from 'vitest';
import { i18n } from '@/shared/i18n/init';
import { formatTypingLabel } from '@/shared/lib/formatTypingLabel';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

describe('formatTypingLabel', () => {
  it('nobody typing returns null', () => {
    expect(formatTypingLabel([], i18n.language)).toBe(null);
  });

  it('one person', () => {
    expect(formatTypingLabel(['Fulano'], i18n.language)).toBe('Fulano está digitando...');
  });

  it('two people', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana'], i18n.language)).toBe('Fulano e Beltrana estão digitando...');
  });

  it('three people: names everyone', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana', 'Ciclano'], i18n.language)).toBe('Fulano, Beltrana e Ciclano estão digitando...');
  });

  it('more than three people: falls back to generic text, without listing names', () => {
    expect(formatTypingLabel(['Fulano', 'Beltrana', 'Ciclano', 'Deltrana'], i18n.language)).toBe('Várias pessoas estão digitando...');
    expect(formatTypingLabel(['a', 'b', 'c', 'd', 'e', 'f'], i18n.language)).toBe('Várias pessoas estão digitando...');
  });
});

describe('formatTypingLabel in English', () => {
  useLanguageForTests('en-US');

  it('conjugates and joins the names the English way', () => {
    expect(formatTypingLabel(['Ana'], i18n.language)).toBe('Ana is typing...');
    expect(formatTypingLabel(['Ana', 'Bia'], i18n.language)).toBe('Ana and Bia are typing...');
    expect(formatTypingLabel(['Ana', 'Bia', 'Caio'], i18n.language)).toBe('Ana, Bia, and Caio are typing...');
    expect(formatTypingLabel(['A', 'B', 'C', 'D'], i18n.language)).toBe('Several people are typing...');
  });
});

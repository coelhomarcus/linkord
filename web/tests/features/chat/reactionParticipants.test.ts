import { describe, expect, it } from 'vitest';
import { i18n } from '@/shared/i18n/init';
import { reactionParticipantName, reactionSummarySentence, summarizeReactionParticipants } from '@/features/chat/reactionParticipants';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

describe('reaction participants', () => {
  it('words who reacted in Portuguese', () => {
    expect(reactionSummarySentence(['Ana'], i18n.language)).toBe('Ana reagiu');
    expect(reactionSummarySentence(['Ana', 'Bia', 'Caio'], i18n.language)).toBe('Ana, Bia e Caio reagiram');
    expect(reactionSummarySentence(['A', 'B', 'C', 'D'], i18n.language)).toBe('A, B, C e mais 1 pessoa reagiram');
    expect(summarizeReactionParticipants(['A', 'B', 'C', 'D', 'E'], i18n.language)).toBe('A, B, C e mais 2');
    expect(reactionParticipantName('me', undefined, 'me', i18n.language)).toBe('Você');
  });

  describe('in English', () => {
    useLanguageForTests('en-US');

    it('words who reacted in English', () => {
      expect(reactionSummarySentence(['Ana'], i18n.language)).toBe('Ana reacted');
      expect(reactionSummarySentence(['Ana', 'Bia', 'Caio'], i18n.language)).toBe('Ana, Bia, and Caio reacted');
      expect(reactionSummarySentence(['A', 'B', 'C', 'D', 'E'], i18n.language)).toBe('A, B, C and 2 other people reacted');
      expect(summarizeReactionParticipants(['A', 'B', 'C', 'D'], i18n.language)).toBe('A, B, C and 1 more');
      expect(reactionParticipantName('u1', undefined, 'me', i18n.language)).toBe('Unavailable participant');
    });
  });
});

import { describe, expect, it } from 'vitest';
import { reactionParticipantName, reactionSummarySentence, summarizeReactionParticipants } from '@/features/chat/reactionParticipants';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

describe('reaction participants', () => {
  it('words who reacted in Portuguese', () => {
    expect(reactionSummarySentence(['Ana'])).toBe('Ana reagiu');
    expect(reactionSummarySentence(['Ana', 'Bia', 'Caio'])).toBe('Ana, Bia e Caio reagiram');
    expect(reactionSummarySentence(['A', 'B', 'C', 'D'])).toBe('A, B, C e mais 1 pessoa reagiram');
    expect(summarizeReactionParticipants(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C e mais 2');
    expect(reactionParticipantName('me', undefined, 'me')).toBe('Você');
  });

  describe('in English', () => {
    useLanguageForTests('en-US');

    it('words who reacted in English', () => {
      expect(reactionSummarySentence(['Ana'])).toBe('Ana reacted');
      expect(reactionSummarySentence(['Ana', 'Bia', 'Caio'])).toBe('Ana, Bia, and Caio reacted');
      expect(reactionSummarySentence(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 other people reacted');
      expect(summarizeReactionParticipants(['A', 'B', 'C', 'D'])).toBe('A, B, C and 1 more');
      expect(reactionParticipantName('u1', undefined, 'me')).toBe('Unavailable participant');
    });
  });
});

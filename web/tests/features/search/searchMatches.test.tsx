import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MessageCard } from '@/features/chat/MessageCard';
import { highlightWords, matchTerms, splitMatches } from '@/features/search/searchMatches';
import type { ChatMessage } from '@/shared/types/protocol';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';

const marks = (text: string, words: string[]) => splitMatches(text, matchTerms(words)).filter((p) => p.match).map((p) => p.text);

describe('splitMatches', () => {
  it('marks a word where it starts a word, accents and case aside', () => {
    expect(marks('Uma Mensagem nova', ['mensagem'])).toEqual(['Mensagem']);
    expect(marks('a ação foi feita', ['acao'])).toEqual(['ação']);
    expect(marks('remensagem', ['mensagem'])).toEqual([]);
  });

  it('marks a prefix and keeps the rest of the text in order', () => {
    expect(splitMatches('render probe', matchTerms(['rend']))).toEqual([
      { text: 'rend', match: true },
      { text: 'er probe', match: false },
    ]);
  });

  it('joins overlapping terms into one mark', () => {
    expect(marks('mensagem', ['men', 'mensagem'])).toEqual(['mensagem']);
  });

  it('ignores one-letter words and query operators', () => {
    expect(matchTerms(highlightWords('a "foo bar" -baz OR qux'))).toEqual(['foo', 'bar', 'qux']);
  });

  it('leaves text whose folding changes its length unmarked', () => {
    expect(marks('ação'.normalize('NFD'), ['acao'])).toEqual([]);
  });
});

const message: ChatMessage = {
  msgId: 1, conversationId: 'conv-1', id: null, name: 'mensagem bot', avatar: '', text: 'uma **mensagem** nova `mensagem`', ts: Date.UTC(2026, 8, 1),
};

describe('search marks in a message card', () => {
  it('marks the message text, not the author or the card buttons', () => {
    const { container } = renderWithRoom(
      <MessageCard message={message} highlight={['mensagem']} actions={<button type="button">Ir para mensagem</button>} />,
    );
    const found = [...container.querySelectorAll('mark')];
    expect(found.map((mark) => mark.textContent)).toEqual(['mensagem', 'mensagem']);
    expect(found.every((mark) => !mark.closest('button'))).toBe(true);
    expect(screen.getByText('mensagem bot').querySelector('mark')).toBeNull();
  });

  it('marks nothing outside a search', () => {
    const { container } = renderWithRoom(<MessageCard message={message} />);
    expect(container.querySelector('mark')).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MessageCard } from '@/features/chat/MessageCard';
import type { ChatMessage } from '@/shared/types/protocol';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';

// jsdom has no CSS Custom Highlight API: record what the hook registers
class FakeHighlight {
  ranges: Range[];
  constructor(...ranges: Range[]) { this.ranges = ranges; }
}
const registry = new Map<string, FakeHighlight>();
const marked = () => (registry.get('search-match')?.ranges ?? []).map((range) => ({
  text: range.toString(),
  inButton: !!range.startContainer.parentElement?.closest('button'),
  inText: !!range.startContainer.parentElement?.closest('p'),
}));

beforeEach(() => {
  registry.clear();
  (globalThis as { Highlight?: unknown }).Highlight = FakeHighlight;
  (globalThis.CSS as unknown as { highlights?: unknown }).highlights = registry;
});
afterEach(() => {
  delete (globalThis as { Highlight?: unknown }).Highlight;
  delete (globalThis.CSS as unknown as { highlights?: unknown }).highlights;
});

const message: ChatMessage = {
  msgId: 1, conversationId: 'conv-1', id: null, name: 'mensagem bot', avatar: '', text: 'uma mensagem nova', ts: Date.UTC(2026, 8, 1),
};

describe('search highlight in a message card', () => {
  it('marks the message text, not the author or the card buttons', () => {
    renderWithRoom(<MessageCard message={message} highlight={['mensagem']} actions={<button type="button">Ir para mensagem</button>} />);
    expect(marked()).toEqual([{ text: 'mensagem', inButton: false, inText: true }]);
  });

  it('skips a closed spoiler', () => {
    renderWithRoom(<MessageCard message={{ ...message, text: 'aberta mensagem ||mensagem secreta||' }} highlight={['mensagem']} />);
    expect(marked()).toHaveLength(1);
  });

  it('takes its ranges back when the card unmounts', () => {
    const { unmount } = renderWithRoom(<MessageCard message={message} highlight={['mensagem']} />);
    expect(marked()).toHaveLength(1);
    unmount();
    expect(marked()).toHaveLength(0);
  });
});

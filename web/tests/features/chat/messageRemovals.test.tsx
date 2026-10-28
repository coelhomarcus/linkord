import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { MessageRow } from '@/features/chat/MessageRow';
import type { ChatAttachment, ChatMessage } from '@/shared/types/protocol';
import type { RoomContextValue } from '@/state/RoomContext';

// the link cards' previews are not what these tests are about
vi.mock('@/features/chat/ChatEmbed', () => ({ ChatEmbed: ({ embed }: { embed: { url: string } }) => <div data-testid="card">{embed.url}</div> }));
vi.mock('@/shared/hooks/useCachedImageSrc', () => ({ useCachedImageSrc: (url: string | null) => url }));

const me = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Eu' } };
const photo = (id: string): ChatAttachment => ({ id, name: `${id}.png`, mime: 'image/png', size: 10, width: 400, height: 300 });

function renderRow(overrides: Partial<ChatMessage>, room: Partial<RoomContextValue> = {}) {
  const message: ChatMessage = { msgId: 7, conversationId: 'c', id: 'me', name: 'Eu', avatar: '', text: '', ts: Date.now(), ...overrides };
  const removeChatAttachment = vi.fn(async () => {});
  const suppressChatEmbed = vi.fn(async () => {});
  renderWithRoom(
    <MessageRow message={message} showHeader highlighted={false} allUsers={new Map()} mentionLookup={new Map()} onOpenProfile={vi.fn()} onReply={vi.fn()} onJumpTo={vi.fn()} />,
    { state: me, removeChatAttachment, suppressChatEmbed, ...room },
  );
  return { removeChatAttachment, suppressChatEmbed };
}

describe('removing a link card', () => {
  it('a removed card is not drawn, while its link stays in the text', () => {
    renderRow({ text: 'veja https://a.com/x e https://b.com/y', suppressedEmbeds: ['https://a.com/x'] });
    expect(screen.getAllByTestId('card').map((c) => c.textContent)).toEqual(['https://b.com/y']);
    expect(screen.getByRole('link', { name: 'https://a.com/x' })).toBeInTheDocument();
  });

  it('the author removes a card after confirming, and the link is what is sent', async () => {
    const { suppressChatEmbed } = renderRow({ text: 'veja https://a.com/x' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remover incorporação' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('O link continua na mensagem');
    await user.click(within(dialog).getByRole('button', { name: 'Remover' }));
    expect(suppressChatEmbed).toHaveBeenCalledWith(7, 'https://a.com/x');
  });

  it("no one removes a card from someone else's message", () => {
    renderRow({ id: 'other', name: 'Outro', text: 'veja https://a.com/x' });
    expect(screen.queryByRole('button', { name: 'Remover incorporação' })).not.toBeInTheDocument();
  });
});

describe('removing an attachment', () => {
  it('with text, the author takes the attachment out after confirming', async () => {
    const { removeChatAttachment } = renderRow({ text: 'a foto', attachments: [photo('f1')] });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remover f1.png' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remover' }));
    expect(removeChatAttachment).toHaveBeenCalledWith(7, 'f1');
  });

  it('several attachments without text: each can go, the others stay', () => {
    renderRow({ text: '', attachments: [photo('f1'), photo('f2')] });
    expect(screen.getByRole('button', { name: 'Remover f1.png' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover f2.png' })).toBeInTheDocument();
  });

  it('a lone attachment with no text cannot be removed: that is deleting the message', () => {
    renderRow({ text: '', attachments: [photo('f1')] });
    expect(screen.queryByRole('button', { name: 'Remover f1.png' })).not.toBeInTheDocument();
  });

  it("no one removes an attachment from someone else's message", () => {
    renderRow({ id: 'other', name: 'Outro', text: 'a foto', attachments: [photo('f1')] });
    expect(screen.queryByRole('button', { name: 'Remover f1.png' })).not.toBeInTheDocument();
  });

  it('cancelling the confirmation removes nothing', async () => {
    const { removeChatAttachment } = renderRow({ text: 'a foto', attachments: [photo('f1')] });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remover f1.png' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(removeChatAttachment).not.toHaveBeenCalled();
  });
});

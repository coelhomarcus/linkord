import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { MessageRow } from '@/features/chat/MessageRow';
import { GlobalContextMenu } from '@/app/layout/GlobalContextMenu';
import type { ChatAttachment, ChatMessage } from '@/shared/types/protocol';

// the link cards' previews are not what these tests are about
vi.mock('@/features/chat/ChatEmbed', () => ({ ChatEmbed: ({ embed }: { embed: { url: string } }) => <div data-testid="card">{embed.url}</div> }));
vi.mock('@/shared/hooks/useCachedImageSrc', () => ({ useCachedImageSrc: (url: string | null) => url }));

const me = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Eu' } };
const photo = (id: string): ChatAttachment => ({ id, name: `${id}.png`, mime: 'image/png', size: 10, width: 400, height: 300 });

function renderRow(overrides: Partial<ChatMessage>) {
  const message: ChatMessage = { msgId: 7, conversationId: 'c', id: 'me', name: 'Eu', avatar: '', text: '', ts: Date.now(), ...overrides };
  renderWithRoom(
    <MessageRow message={message} showHeader highlighted={false} allUsers={new Map()} mentionLookup={new Map()} onOpenProfile={vi.fn()} onReply={vi.fn()} onJumpTo={vi.fn()} />,
    { state: me },
  );
}

// taking one attachment or link card out goes through the right-click menu
// on it; the row itself draws no remove button
function renderInMenu(overrides: Partial<ChatMessage>, state = me) {
  const message: ChatMessage = { msgId: 7, conversationId: 'c', id: 'me', name: 'Eu', avatar: '', text: '', ts: Date.now(), ...overrides };
  const removeChatAttachment = vi.fn(async () => {});
  const suppressChatEmbed = vi.fn(async () => {});
  renderWithRoom(
    <GlobalContextMenu onOpenProfile={vi.fn()}>
      <MessageRow message={message} showHeader highlighted={false} allUsers={new Map()} mentionLookup={new Map()} onOpenProfile={vi.fn()} onReply={vi.fn()} onJumpTo={vi.fn()} />
    </GlobalContextMenu>,
    { state, removeChatAttachment, suppressChatEmbed, activeConversationId: 'c', messagesByConversation: new Map([['c', [message]]]) },
  );
  return { removeChatAttachment, suppressChatEmbed };
}

describe('removing a link card', () => {
  it('a removed card is not drawn, while its link stays in the text', () => {
    renderRow({ text: 'veja https://a.com/x e https://b.com/y', suppressedEmbeds: ['https://a.com/x'] });
    expect(screen.getAllByTestId('card').map((c) => c.textContent)).toEqual(['https://b.com/y']);
    expect(screen.getByRole('link', { name: 'https://a.com/x' })).toBeInTheDocument();
  });

  it('no remove button sits on the card itself', () => {
    renderRow({ text: 'veja https://a.com/x' });
    expect(screen.queryByRole('button', { name: 'Remover incorporação' })).not.toBeInTheDocument();
  });

  it('the author removes the right-clicked card after confirming, and its link is what is sent', async () => {
    const { suppressChatEmbed } = renderInMenu({ text: 'veja https://a.com/x e https://b.com/y' });
    const user = userEvent.setup();
    fireEvent.contextMenu(screen.getAllByTestId('card')[1]!);
    await user.click(await screen.findByRole('menuitem', { name: 'Remover incorporação' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('O link continua na mensagem');
    await user.click(within(dialog).getByRole('button', { name: 'Remover' }));
    expect(suppressChatEmbed).toHaveBeenCalledWith(7, 'https://b.com/y');
  });

  it("no one removes a card from someone else's message, not even an admin", async () => {
    const admin = { ...me, me: { ...me.me, role: 'admin' as const } };
    renderInMenu({ id: 'other', name: 'Outro', text: 'veja https://a.com/x' }, admin);
    fireEvent.contextMenu(screen.getByTestId('card'));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'Remover incorporação' })).not.toBeInTheDocument();
  });
});

describe('removing an attachment', () => {
  const openMenuOn = async (name: RegExp) => {
    fireEvent.contextMenu(screen.getByRole('button', { name }));
    await screen.findByRole('menu');
  };

  it('no remove button sits on the attachment itself', () => {
    renderInMenu({ text: 'a foto', attachments: [photo('f1')] });
    expect(screen.queryByRole('button', { name: 'Remover f1.png' })).not.toBeInTheDocument();
  });

  it('with text, the author takes the attachment out from its menu after confirming', async () => {
    const { removeChatAttachment } = renderInMenu({ text: 'a foto', attachments: [photo('f1')] });
    const user = userEvent.setup();
    await openMenuOn(/^Abrir f1\.png/);
    await user.click(screen.getByRole('menuitem', { name: 'Remover anexo' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('"f1.png" sai da mensagem');
    await user.click(within(dialog).getByRole('button', { name: 'Remover' }));
    expect(removeChatAttachment).toHaveBeenCalledWith(7, 'f1');
  });

  it('several attachments: the one right-clicked is the one removed', async () => {
    const { removeChatAttachment } = renderInMenu({ text: '', attachments: [photo('f1'), photo('f2')] });
    const user = userEvent.setup();
    await openMenuOn(/^Abrir f2\.png/);
    await user.click(screen.getByRole('menuitem', { name: 'Remover anexo' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remover' }));
    expect(removeChatAttachment).toHaveBeenCalledWith(7, 'f2');
  });

  it('a right-click on the text, not an attachment, does not offer it', async () => {
    renderInMenu({ text: 'a foto', attachments: [photo('f1')] });
    fireEvent.contextMenu(screen.getByText('a foto'));
    await screen.findByRole('menu');
    expect(screen.queryByRole('menuitem', { name: 'Remover anexo' })).not.toBeInTheDocument();
  });

  it('a lone attachment with no text cannot be removed: that is deleting the message', async () => {
    renderInMenu({ text: '', attachments: [photo('f1')] });
    await openMenuOn(/^Abrir f1\.png/);
    expect(screen.queryByRole('menuitem', { name: 'Remover anexo' })).not.toBeInTheDocument();
  });

  it("no one removes an attachment from someone else's message", async () => {
    renderInMenu({ id: 'other', name: 'Outro', text: 'a foto', attachments: [photo('f1')] });
    await openMenuOn(/^Abrir f1\.png/);
    expect(screen.queryByRole('menuitem', { name: 'Remover anexo' })).not.toBeInTheDocument();
  });

  it("an admin removes an attachment from someone else's message", async () => {
    const admin = { ...me, me: { ...me.me, role: 'admin' as const } };
    const { removeChatAttachment } = renderInMenu({ id: 'other', name: 'Outro', text: 'a foto', attachments: [photo('f1')] }, admin);
    const user = userEvent.setup();
    await openMenuOn(/^Abrir f1\.png/);
    await user.click(screen.getByRole('menuitem', { name: 'Remover anexo' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remover' }));
    expect(removeChatAttachment).toHaveBeenCalledWith(7, 'f1');
  });

  it('on a phone, holding the attachment opens the menu that removes it', async () => {
    const { removeChatAttachment } = renderInMenu({ text: 'a foto', attachments: [photo('f1')] });
    const picture = screen.getByRole('button', { name: /^Abrir f1\.png/ });
    vi.useFakeTimers();
    fireEvent.touchStart(picture, { touches: [{ clientX: 20, clientY: 20 }] });
    await act(async () => { vi.advanceTimersByTime(550); });
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('menuitem', { name: 'Remover anexo' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remover' }));
    expect(removeChatAttachment).toHaveBeenCalledWith(7, 'f1');
  });

  it('cancelling the confirmation removes nothing', async () => {
    const { removeChatAttachment } = renderInMenu({ text: 'a foto', attachments: [photo('f1')] });
    const user = userEvent.setup();
    await openMenuOn(/^Abrir f1\.png/);
    await user.click(screen.getByRole('menuitem', { name: 'Remover anexo' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancelar' }));
    expect(removeChatAttachment).not.toHaveBeenCalled();
  });
});

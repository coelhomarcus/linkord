import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { RoomStoreProvider } from '@/state/RoomStoreProvider';
import { PlaygroundChat } from '@/features/playground/PlaygroundChat';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import type { RoomContextValue } from '@/state/RoomContext';
import type { ChatMessage, ChannelSummary, ServerSummary } from '@/shared/types/protocol';

const VIEW_AND_SEND = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES;

function channel(overrides: Partial<ChannelSummary>): ChannelSummary {
  return { id: '', serverId: 's1', type: 'text', name: '', topic: '', categoryId: null, position: 0, permissionsSynced: true, permissions: VIEW_AND_SEND, ...overrides };
}

function server(channels: ChannelSummary[]): ServerSummary {
  return { id: 's1', name: 'Equipe', channels } as unknown as ServerSummary;
}

const message = (msgId: number, text: string, name = 'Bia'): ChatMessage =>
  ({ msgId, conversationId: 'geral', id: null, name, avatar: '', text, ts: msgId }) as ChatMessage;

const playground = (chatId: string | null) => channel({ id: 'pg', type: 'voice', voiceMode: 'playground', name: 'Playground', playgroundChatId: chatId });

function setup(overrides: Partial<RoomContextValue>, open = true) {
  const onClose = vi.fn();
  const ui = (value: RoomContextValue, isOpen: boolean) => (
    <RoomStoreProvider value={value}><PlaygroundChat callConversationId="pg" open={isOpen} onClose={onClose} /></RoomStoreProvider>
  );
  const value = createFakeRoomContextValue(overrides);
  const view = render(ui(value, open));
  return { onClose, rerender: (next: Partial<RoomContextValue>, isOpen = open) => view.rerender(ui(createFakeRoomContextValue({ ...overrides, ...next }), isOpen)) };
}

describe('PlaygroundChat', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it("shows the linked channel's messages and sends what is typed there, closing on Enter", () => {
    const sendChatMessage = vi.fn();
    const { onClose } = setup({
      servers: [server([playground('geral'), channel({ id: 'geral', name: 'chat-geral' })])],
      messagesByConversation: new Map([['geral', [message(1, 'oi pessoal')]]]),
      sendChatMessage,
    });
    expect(screen.getByRole('log', { name: 'Chat do jogo, #chat-geral' })).toHaveTextContent('<Bia> oi pessoal');
    const input = screen.getByRole('textbox', { name: 'Mensagem em #chat-geral' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  bora jogar  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendChatMessage).toHaveBeenCalledWith('geral', 'bora jogar');
    expect(onClose).toHaveBeenCalled();
  });

  it('brings back what was sent with the up arrow', () => {
    setup({ servers: [server([playground('geral'), channel({ id: 'geral', name: 'chat-geral' })])], messagesByConversation: new Map([['geral', []]]) });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'primeira' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input).toHaveValue('primeira');
  });

  it("asks for the channel's history when the app does not have it yet", () => {
    const sendWs = vi.fn(() => true);
    setup({ servers: [server([playground('geral'), channel({ id: 'geral', name: 'chat-geral' })])], sendWs });
    expect(sendWs).toHaveBeenCalledWith({ t: 'conversation-open', conversationId: 'geral' });
  });

  it('says so when no chat is linked, or when its channel is out of reach', () => {
    const { rerender } = setup({ servers: [server([playground(null)])] });
    expect(screen.getByRole('log')).toHaveTextContent('Este playground não tem chat');
    rerender({ servers: [server([playground('hidden')])] });
    expect(screen.getByRole('log')).toHaveTextContent('Você não tem acesso ao canal do chat do jogo.');
  });

  it('does not send where the member cannot post', () => {
    const sendChatMessage = vi.fn();
    setup({
      servers: [server([playground('avisos'), channel({ id: 'avisos', name: 'avisos', permissions: PERMISSIONS.VIEW_CHANNEL })])],
      messagesByConversation: new Map([['avisos', []]]),
      sendChatMessage,
    });
    expect(screen.getByRole('log')).toHaveTextContent('Você não pode enviar mensagens em #avisos.');
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'oi' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('shows a new message over the world for a while when closed, but not the old ones', () => {
    const servers = [server([playground('geral'), channel({ id: 'geral', name: 'chat-geral' })])];
    const { rerender } = setup({ servers, messagesByConversation: new Map([['geral', [message(1, 'antiga')]]]) }, false);
    expect(screen.queryByText(/antiga/)).not.toBeInTheDocument();
    rerender({ messagesByConversation: new Map([['geral', [message(1, 'antiga'), message(2, 'nova')]]]) });
    expect(screen.getByText(/nova/)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(10_500); });
    expect(screen.queryByText(/nova/)).not.toBeInTheDocument();
  });

  it('shows twenty lines and scrolls by lines with the wheel, staying put as new ones arrive', () => {
    const servers = [server([playground('geral'), channel({ id: 'geral', name: 'chat-geral' })])];
    const many = Array.from({ length: 30 }, (_, i) => message(i + 1, `linha ${i + 1}`));
    const { rerender } = setup({ servers, messagesByConversation: new Map([['geral', many]]) });
    const log = screen.getByRole('log');
    expect(log.querySelectorAll('li')).toHaveLength(20);
    expect(log).toHaveTextContent('linha 30');
    expect(log).not.toHaveTextContent('linha 10 ');
    fireEvent.wheel(log, { deltaY: -100 });
    expect(log).toHaveTextContent('linha 4');
    expect(log).not.toHaveTextContent('linha 30');
    rerender({ messagesByConversation: new Map([['geral', [...many, message(31, 'linha 31')]]]) });
    expect(screen.getByRole('log')).not.toHaveTextContent('linha 31');
    fireEvent.wheel(screen.getByRole('log'), { deltaY: 100 });
    fireEvent.wheel(screen.getByRole('log'), { deltaY: 100 });
    expect(screen.getByRole('log')).toHaveTextContent('linha 31');
  });

  it('draws links underlined and clickable, stickers and pictures, not only their text', () => {
    const withLink = message(1, 'olha https://example.com/mapa');
    const sticker = { ...message(2, ''), sticker: { id: 'st1', name: 'Joinha' } } as ChatMessage;
    const picture = { ...message(3, ''), attachments: [{ id: 'a1', name: 'print.png', mime: 'image/png', size: 10, thumbId: 't1', width: 100, height: 50 }] } as ChatMessage;
    const file = { ...message(4, ''), attachments: [{ id: 'a2', name: 'notas.txt', mime: 'text/plain', size: 10 }] } as ChatMessage;
    setup({
      servers: [server([playground('geral'), channel({ id: 'geral', name: 'chat-geral' })])],
      messagesByConversation: new Map([['geral', [withLink, sticker, picture, file]]]),
    });
    const link = screen.getByRole('link', { name: 'https://example.com/mapa' });
    expect(link).toHaveAttribute('href', 'https://example.com/mapa');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('img', { name: 'Figurinha: Joinha' })).toHaveAttribute('src', '/api/stickers/st1');
    expect(screen.getByRole('img', { name: 'print.png' })).toHaveAttribute('src', '/uploads/t1');
    expect(screen.getByRole('link', { name: 'notas.txt' })).toHaveAttribute('href', '/uploads/a2');
  });
});


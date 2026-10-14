import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { MessageComposer } from '@/features/chat/MessageComposer';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import type { GifConfig } from '@/shared/api/api';
import * as klipy from '@/features/gifs/klipy';

const config = vi.hoisted(() => ({ current: null as GifConfig | null }));
vi.mock('@/features/gifs/useGifConfig', () => ({ useGifConfig: () => config.current }));
vi.mock('@/features/gifs/klipy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/gifs/klipy')>()),
  fetchTrendingGifs: vi.fn(), fetchGifCategories: vi.fn(), reportGifShared: vi.fn(),
}));
const mocked = vi.mocked(klipy);

const joinedState = { ...initialRoomState, joined: true };
const enabled = { enabled: true as const, apiKey: 'k', customerId: 'c' };
const gif = {
  slug: 'hello-1', title: 'Hello', placeholder: null,
  preview: { url: 'https://static.klipy.com/ii/a/sm.webp', width: 220, height: 124 },
  full: { url: 'https://static.klipy.com/ii/a/md.webp', width: 498, height: 280 },
};

afterEach(() => clearAllDrafts());

describe('MessageComposer — GIFs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.fetchTrendingGifs.mockResolvedValue({ items: [gif], page: 1, hasNext: false });
    mocked.fetchGifCategories.mockResolvedValue([]);
  });

  it('without a KLIPY key on the server there is no GIF button', () => {
    config.current = { enabled: false };
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });
    expect(screen.queryByRole('button', { name: 'Enviar GIF' })).not.toBeInTheDocument();
  });

  it('picking a GIF sends its URL as a message, keeps the draft, and tells KLIPY it was shared', async () => {
    config.current = enabled;
    const user = userEvent.setup();
    const sendChatMessage = vi.fn(() => true);
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState, sendChatMessage });
    await user.type(screen.getByPlaceholderText('Mensagem'), 'rascunho');

    await user.click(screen.getByRole('button', { name: 'Enviar GIF' }));
    // KLIPY's attribution rules
    expect(screen.getByPlaceholderText('Search KLIPY')).toBeInTheDocument();
    expect(screen.getByText('Powered by KLIPY')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Hello' }));

    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', gif.full.url, undefined);
    expect(mocked.reportGifShared).toHaveBeenCalledWith(enabled, 'hello-1', '');
    expect(screen.getByPlaceholderText('Mensagem')).toHaveValue('rascunho');
  });
});

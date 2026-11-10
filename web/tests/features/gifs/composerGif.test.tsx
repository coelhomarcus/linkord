import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { MessageComposer } from '@/features/chat/MessageComposer';
import { clearAllDrafts } from '@/features/chat/conversationDrafts';
import type { GifConfig } from '@/shared/api/api';
import * as klipy from '@/features/gifs/klipy';
import { primeTestEmojiData } from '@tests/fixtures/emojiDataFixture';
import { typeInField, fieldValue } from '@tests/fixtures/messageFieldFixture';

const config = vi.hoisted(() => ({ current: null as GifConfig | null }));
vi.mock('@/features/gifs/useGifConfig', () => ({ useGifConfig: () => config.current }));
vi.mock('@/features/gifs/klipy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/gifs/klipy')>()),
  fetchTrendingGifs: vi.fn(), reportGifShared: vi.fn(),
}));
const mocked = vi.mocked(klipy);

const joinedState = { ...initialRoomState, joined: true };
const enabled = { enabled: true as const, apiKey: 'k', customerId: 'c' };
const gif = {
  slug: 'hello-1', title: 'Hello', placeholder: null,
  preview: { url: 'https://static.klipy.com/ii/a/sm.webp', width: 220, height: 124 },
  full: { url: 'https://static.klipy.com/ii/a/md.webp', width: 498, height: 280 },
};

// jsdom has no layout: give elements a size, the way the picker's virtualized
// grid reads it, or it would draw no GIFs at all
const sizes = ['offsetHeight', 'offsetWidth'] as const;
const originals = sizes.map((key) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 320 });
});
afterEach(() => {
  clearAllDrafts();
  sizes.forEach((key, index) => { if (originals[index]) Object.defineProperty(HTMLElement.prototype, key, originals[index]!); });
});

describe('MessageComposer — GIFs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.fetchTrendingGifs.mockResolvedValue({ items: [gif], page: 1, hasNext: false });
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
    await typeInField(screen.getByPlaceholderText('Mensagem'), 'rascunho');

    await user.click(screen.getByRole('button', { name: 'Enviar GIF' }));
    // KLIPY's attribution rules
    expect(screen.getByPlaceholderText('Search KLIPY')).toBeInTheDocument();
    expect(screen.getByText('Powered by KLIPY')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Hello' }));

    expect(sendChatMessage).toHaveBeenCalledWith('conv-1', gif.full.url, undefined);
    expect(mocked.reportGifShared).toHaveBeenCalledWith(enabled, 'hello-1', '');
    expect(fieldValue(screen.getByPlaceholderText('Mensagem'))).toBe('rascunho');
  });

  it('the GIF picker and the emoji picker are tabs of one panel', async () => {
    config.current = enabled;
    primeTestEmojiData();
    const user = userEvent.setup();
    renderWithRoom(<MessageComposer conversationId="conv-1" />, { state: joinedState });

    await user.click(screen.getByRole('button', { name: 'Enviar GIF' }));
    expect(screen.getByRole('tab', { name: 'GIFs' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Emoji' }));
    await user.click(await screen.findByRole('gridcell', { name: '🐶 dog face' }));
    expect(fieldValue(screen.getByPlaceholderText('Mensagem'))).toBe('🐶');
  });
});

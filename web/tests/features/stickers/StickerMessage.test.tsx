import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { StickerMessage } from '@/features/stickers/StickerMessage';
import { resetMyStickers, setMyStickersForTests } from '@/features/stickers/myStickers';
import { type RoomContextValue } from '@/state/RoomContext';
import { RoomStoreProvider } from '@/state/RoomStoreProvider';

const card = { id: 'a'.repeat(32), name: 'abraço', description: 'dois gatos se abraçando', animated: false };

function inRoom(children: ReactNode, activeConversationId: string | null = null) {
  const servers = [{ id: 's1', name: 'Equipe', icon: '', permissions: 0, channels: [{ id: 'c1' }] }] as unknown as RoomContextValue['servers'];
  const value = { state: { me: { userId: 'me' } }, servers, activeConversationId } as unknown as RoomContextValue;
  return <RoomStoreProvider value={value}>{children}</RoomStoreProvider>;
}

afterEach(() => { resetMyStickers(); vi.restoreAllMocks(); });

describe('StickerMessage', () => {
  it('draws the sticker large, described for screen readers', () => {
    render(inRoom(<StickerMessage sticker={card} />));
    const image = screen.getByRole('img', { name: 'dois gatos se abraçando' });
    expect(image).toHaveAttribute('src', `/api/stickers/${card.id}`);
    expect(image).toHaveAttribute('width', '160');
  });

  it('names its server to anyone, and tells someone outside it that only members use it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => (
      new Response(JSON.stringify({ server: { id: 's9', name: 'Gatos', icon: '' } }), { headers: { 'Content-Type': 'application/json' } })
    ));
    setMyStickersForTests('me', []);
    const { unmount } = render(inRoom(<StickerMessage sticker={card} />));
    await userEvent.click(screen.getByRole('button', { name: 'Figurinha abraço' }));
    expect(await screen.findByText('Esta figurinha é de um servidor em que você não está. Só os membros dele podem usá-la.')).toBeInTheDocument();
    expect(await screen.findByText('Gatos')).toBeInTheDocument();
    expect(screen.getByText('Esta figurinha é de')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(`/api/stickers/${card.id}/source`, expect.anything());
    unmount();
    fetchSpy.mockClear();

    setMyStickersForTests('me', [{ serverId: 's1', stickers: [{ ...card, emoji: '🤗', serverId: 's1' }] }]);
    render(inRoom(<StickerMessage sticker={card} />));
    await userEvent.click(screen.getByRole('button', { name: 'Figurinha abraço' }));
    expect(await screen.findByText('Esta figurinha é de um dos seus servidores. Você pode usá-la em qualquer lugar.')).toBeInTheDocument();
    expect(screen.getByText('Esta figurinha é de')).toBeInTheDocument();
    expect(screen.getByText('Equipe')).toBeInTheDocument();
    expect(screen.getByText('Servidor apenas para convidados')).toBeInTheDocument();
    // a member's own servers are already known
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls it this server\'s inside one of that server\'s channels', async () => {
    setMyStickersForTests('me', [{ serverId: 's1', stickers: [{ ...card, emoji: '🤗', serverId: 's1' }] }]);
    render(inRoom(<StickerMessage sticker={card} />, 'c1'));
    await userEvent.click(screen.getByRole('button', { name: 'Figurinha abraço' }));
    expect(await screen.findByText('Esta figurinha é deste servidor. Você pode usá-la em qualquer lugar.')).toBeInTheDocument();
  });

  it('reads as unavailable once the sticker was deleted', () => {
    render(inRoom(<StickerMessage sticker={null} />));
    expect(screen.getByText('Figurinha indisponível')).toBeInTheDocument();
  });

  it('falls back to its name when the file is gone', () => {
    render(inRoom(<StickerMessage sticker={card} />));
    fireEvent.error(screen.getByRole('img'));
    expect(screen.getByText('Figurinha: abraço')).toBeInTheDocument();
  });
});

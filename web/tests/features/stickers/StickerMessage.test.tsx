import { afterEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { StickerMessage } from '@/features/stickers/StickerMessage';
import { resetMyStickers, setMyStickersForTests } from '@/features/stickers/myStickers';
import { RoomContext, type RoomContextValue } from '@/state/RoomContext';

const card = { id: 'a'.repeat(32), name: 'abraço', description: 'dois gatos se abraçando', animated: false };

function inRoom(children: ReactNode) {
  const servers = [{ id: 's1', name: 'Equipe', icon: '', permissions: 0 }] as unknown as RoomContextValue['servers'];
  return <RoomContext.Provider value={{ state: { me: { userId: 'me' } }, servers } as unknown as RoomContextValue}>{children}</RoomContext.Provider>;
}

afterEach(() => resetMyStickers());

describe('StickerMessage', () => {
  it('draws the sticker large, described for screen readers', () => {
    render(inRoom(<StickerMessage sticker={card} />));
    const image = screen.getByRole('img', { name: 'dois gatos se abraçando' });
    expect(image).toHaveAttribute('src', `/api/stickers/${card.id}`);
    expect(image).toHaveAttribute('width', '160');
  });

  it('says which server it is from to a member there, and not to anyone else', async () => {
    const { unmount } = render(inRoom(<StickerMessage sticker={card} />));
    await userEvent.click(screen.getByRole('button', { name: 'Figurinha abraço' }));
    expect(await screen.findByText('De um servidor em que você não está')).toBeInTheDocument();
    unmount();

    setMyStickersForTests('me', [{ serverId: 's1', stickers: [{ ...card, emoji: '🤗', serverId: 's1' }] }]);
    render(inRoom(<StickerMessage sticker={card} />));
    await userEvent.click(screen.getByRole('button', { name: 'Figurinha abraço' }));
    expect(await screen.findByText('De Equipe')).toBeInTheDocument();
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

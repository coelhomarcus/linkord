import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { StickerPicker } from '@/features/stickers/StickerPicker';
import { resetMyStickers, setMyStickersForTests } from '@/features/stickers/myStickers';
import { resetFrequentExpressions } from '@/features/emoji/frequentExpressions';
import { registerStickerEditorOpener } from '@/features/stickers/stickerEditorRequest';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { RoomContext, type RoomContextValue } from '@/state/RoomContext';

const hug = { id: 'a'.repeat(32), name: 'abraço', description: 'dois gatos', emoji: '🤗', animated: false, serverId: 's1' };
const wave = { id: 'b'.repeat(32), name: 'tchau', description: '', emoji: '👋', animated: true, serverId: 's1' };

function inRoom(children: ReactNode, permissions = 0) {
  const servers = [{ id: 's1', name: 'Equipe', icon: '', permissions }] as unknown as RoomContextValue['servers'];
  return <RoomContext.Provider value={{ state: { me: { userId: 'me' } }, servers } as unknown as RoomContextValue}>{children}</RoomContext.Provider>;
}

beforeEach(() => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (
    String(input).includes('frequent-expressions') ? json({ emojis: [], sounds: [], stickers: [] }) : json({ servers: [] })
  ));
  setMyStickersForTests('me', [{ serverId: 's1', stickers: [hug, wave] }]);
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  resetMyStickers();
  resetFrequentExpressions();
  vi.restoreAllMocks();
});

const search = () => screen.getByRole('searchbox', { name: 'Buscar figurinha' });

describe('StickerPicker', () => {
  it("lists the account's stickers under their server and sends the one clicked", async () => {
    const onPick = vi.fn();
    render(inRoom(<StickerPicker onPick={onPick} />));
    expect(screen.getByRole('rowgroup', { name: 'Equipe' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('gridcell', { name: 'tchau' }));
    expect(onPick).toHaveBeenCalledWith(wave);
  });

  it('names what is under the pointer, and the server it is from', async () => {
    render(inRoom(<StickerPicker onPick={() => {}} />));
    await userEvent.hover(screen.getByRole('gridcell', { name: 'abraço' }));
    expect(screen.getByText('De Equipe')).toBeInTheDocument();
  });

  it('searches by name or description and sends the first result on Enter', async () => {
    const onPick = vi.fn();
    render(inRoom(<StickerPicker onPick={onPick} />));
    await userEvent.type(search(), 'gatos');
    expect(screen.queryByRole('gridcell', { name: 'tchau' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(hug);
  });

  it('moves through the stickers with the arrows', async () => {
    const onPick = vi.fn();
    render(inRoom(<StickerPicker onPick={onPick} />));
    await userEvent.click(search());
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{Enter}');
    expect(onPick).toHaveBeenCalledWith(wave);
  });

  it('asks for the upload dialog from the add tile, where the account may add', async () => {
    const opener = vi.fn();
    const unregister = registerStickerEditorOpener(opener);
    render(inRoom(<StickerPicker onPick={() => {}} />, PERMISSIONS.CREATE_EXPRESSIONS));
    await userEvent.click(screen.getByRole('gridcell', { name: 'Adicionar figurinha em Equipe' }));
    expect(opener).toHaveBeenCalledWith({ serverId: 's1', sticker: undefined });
    unregister();
  });

  it('says where stickers come from when there are none', () => {
    setMyStickersForTests('me', []);
    render(inRoom(<StickerPicker onPick={() => {}} />));
    expect(screen.getByText(/Nenhuma figurinha ainda/)).toBeInTheDocument();
  });
});

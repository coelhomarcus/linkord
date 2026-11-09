import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { EmojiPicker } from '@/features/emoji/EmojiPicker';
import { resetMyEmojis, setMyEmojisForTests } from '@/features/emoji/myEmojis';
import { resetFrequentExpressions } from '@/features/emoji/frequentExpressions';
import { setSkinTone } from '@/features/emoji/skinTone';
import { registerEmojiUploadOpener } from '@/features/emoji/emojiUploadRequest';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { RoomContext, type RoomContextValue } from '@/state/RoomContext';
import { primeTestEmojiData } from '@tests/fixtures/emojiDataFixture';

const party = { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'party_cat', animated: true, serverId: 's1' };

/** Answers the frequent-use list with `emojis`, and the account's server emojis with none. */
function frequentResponse(emojis: { key: string; count: number }[]) {
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => (
    String(input).includes('frequent-expressions') ? json({ emojis, sounds: [] }) : json({ servers: [] })
  ));
}

function inRoom(children: ReactNode, permissions = 0) {
  const servers = [{ id: 's1', name: 'Equipe', icon: '', permissions }] as unknown as RoomContextValue['servers'];
  return <RoomContext.Provider value={{ state: { me: { userId: 'me' } }, servers } as unknown as RoomContextValue}>{children}</RoomContext.Provider>;
}

// jsdom has no layout: give elements the size the virtualizer reads
// (offsetWidth/offsetHeight), or it draws no rows at all
const sizes = ['offsetHeight', 'offsetWidth'] as const;
const originals = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  primeTestEmojiData();
  frequentResponse([]);
  for (const key of sizes) {
    originals.set(key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key));
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => 400 });
  }
});

afterEach(() => {
  for (const key of sizes) {
    const original = originals.get(key);
    if (original) Object.defineProperty(HTMLElement.prototype, key, original);
  }
  resetMyEmojis();
  resetFrequentExpressions();
  setSkinTone(0);
  vi.restoreAllMocks();
});

const grid = () => screen.getByRole('grid', { name: 'Emojis' });
const search = () => screen.getByRole('searchbox', { name: 'Buscar emoji' });

describe('EmojiPicker', () => {
  it('lays the emojis out by category, with a button per section to jump to it', () => {
    render(<EmojiPicker onPick={() => {}} />);
    const sections = screen.getByRole('navigation', { name: 'Seções de emojis' });
    expect(within(sections).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Pessoas', 'Natureza', 'Comida']);
    expect(within(grid()).getByRole('button', { name: 'Recolher Pessoas' })).toHaveAttribute('aria-expanded', 'true');
    expect(within(grid()).getByRole('gridcell', { name: '😂 face with tears of joy' })).toBeInTheDocument();
  });

  it('picks with a click: the emoji itself, both as reaction and as text', async () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    await userEvent.setup().click(screen.getByRole('gridcell', { name: '🐶 dog face' }));
    expect(onPick).toHaveBeenCalledWith({ key: '🐶', text: '🐶', emoji: '🐶' });
  });

  it('searches names and keywords; Enter picks the first result', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    await user.type(search(), 'dog');
    expect(within(grid()).getAllByRole('gridcell').map((c) => c.textContent)).toEqual(['🐶', '🌭']);
    expect(screen.getByText(':dog:')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ key: '🐶' }));
  });

  it('arrows move through the grid from the search field, which keeps focus', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={() => {}} />);
    await user.click(search());
    await user.keyboard('{ArrowRight}{ArrowRight}');
    const active = document.getElementById(search().getAttribute('aria-activedescendant')!);
    expect(active).toHaveAccessibleName('😆 grinning squinting face');
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(search()).toHaveFocus();
    expect(screen.getByText(':laughing:')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}');
    expect(document.getElementById(search().getAttribute('aria-activedescendant')!)).toHaveAccessibleName('🐶 dog face');
  });

  it('collapses a section', async () => {
    render(<EmojiPicker onPick={() => {}} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Recolher Natureza' }));
    expect(screen.queryByRole('gridcell', { name: '🐶 dog face' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expandir Natureza' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('applies the chosen skin tone', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onPick={() => {}} />);
    await user.click(screen.getByRole('button', { name: 'Tom de pele' }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Média' }));
    expect(screen.getByRole('gridcell', { name: '👋🏽 waving hand' })).toBeInTheDocument();
  });

  it('lists what the account uses most first', async () => {
    frequentResponse([{ key: '🌭', count: 4 }, { key: '👋🏾', count: 2 }]);
    render(inRoom(<EmojiPicker onPick={() => {}} />));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recolher Utilizados com frequência' })).toBeInTheDocument());
    const cells = within(grid()).getAllByRole('gridcell').map((c) => c.textContent);
    expect(cells.slice(0, 2)).toEqual(['🌭', '👋']);
  });

  it('offers the account\'s server emojis, picked as :name: and reacted as custom:<id>', async () => {
    setMyEmojisForTests('me', [{ serverId: 's1', emojis: [party] }]);
    const onPick = vi.fn();
    render(inRoom(<EmojiPicker onPick={onPick} />));
    expect(within(screen.getByRole('navigation')).getByRole('button', { name: 'Equipe' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('gridcell', { name: ':party_cat:' }));
    expect(onPick).toHaveBeenCalledWith({ key: 'custom:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', text: ':party_cat:', custom: party });
  });

  it('leaves server emojis out where only a Unicode one fits', () => {
    setMyEmojisForTests('me', [{ serverId: 's1', emojis: [party] }]);
    render(inRoom(<EmojiPicker onPick={() => {}} allowCustom={false} />));
    expect(screen.queryByRole('gridcell', { name: ':party_cat:' })).not.toBeInTheDocument();
  });

  it('whoever may add emojis to a server gets a tile for it', async () => {
    setMyEmojisForTests('me', [{ serverId: 's1', emojis: [party] }]);
    const opener = vi.fn();
    const unregister = registerEmojiUploadOpener(opener);
    render(inRoom(<EmojiPicker onPick={() => {}} />, PERMISSIONS.CREATE_EXPRESSIONS));
    await userEvent.setup().click(screen.getByRole('gridcell', { name: 'Adicionar emoji em Equipe' }));
    expect(opener).toHaveBeenCalledWith('s1', undefined);
    unregister();
  });
});

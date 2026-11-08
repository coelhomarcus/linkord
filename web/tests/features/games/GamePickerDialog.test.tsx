import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GamePickerDialog } from '@/features/games/GamePickerDialog';
import * as api from '@/features/games/gamesApi';
import { clearGameSearchCache } from '@/features/games/useGameSearch';
import type { GameItem } from '@/features/games/types';
import { ApiError } from '@/shared/api/api';
import { game } from './fixtures';

vi.mock('@/features/games/gamesApi', () => ({ searchGames: vi.fn() }));
const search = vi.mocked(api.searchGames);
beforeEach(() => { clearGameSearchCache(); search.mockReset(); search.mockResolvedValue({ games: [game(1), game(2), game(3, { coverImageId: null, imageUrl: null, releaseYear: null })] }); });

function Harness({ taken = [], onPick }: { taken?: number[]; onPick?: (game: GameItem) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}>abrir</button>
    <GamePickerDialog open={open} widgetName="Jogos que eu gosto" taken={taken} onOpenChange={setOpen} onPick={(picked) => { onPick?.(picked); setOpen(false); }} />
  </>;
}
const openIt = async () => { await userEvent.click(screen.getByRole('button', { name: 'abrir' })); return screen.findByRole('dialog'); };
const searchbox = () => screen.getByRole('searchbox', { name: 'Buscar jogo' });
const results = () => screen.findByRole('list', { name: 'Resultados da busca' }, { timeout: 3000 });

describe('game picker window', () => {
  it('opens over the page with the search focused, named after the widget it fills', async () => {
    render(<Harness />);
    const dialog = await openIt();
    expect(within(dialog).getByRole('heading', { name: 'Escolher jogo' })).toBeInTheDocument();
    expect(within(dialog).getByText('Jogos que eu gosto')).toBeInTheDocument();
    expect(searchbox()).toHaveFocus();
    expect(within(dialog).getByText('Digite pelo menos 2 letras para buscar.')).toBeInTheDocument();
    expect(within(dialog).getByText('Capas e dados dos jogos: IGDB')).toBeInTheDocument();
  });

  it('waits for the typing to stop, then lists each game by name and year with its cover', async () => {
    render(<Harness />);
    await openIt();
    await userEvent.type(searchbox(), 'zelda');
    expect(screen.getByRole('status')).toHaveTextContent('Buscando jogos…');
    expect(search).not.toHaveBeenCalled();
    const list = await results();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('zelda', expect.any(AbortSignal));
    expect(within(list).getByRole('button', { name: 'Escolher Game 1 (2001)' })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: 'Escolher Game 3' })).toBeInTheDocument();
    expect(list.querySelectorAll('img')).toHaveLength(2);
    expect(list.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('does not search for one character', async () => {
    render(<Harness />);
    await openIt();
    await userEvent.type(searchbox(), 'z');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(search).not.toHaveBeenCalled();
  });

  it('hands back the game picked and closes', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await openIt();
    await userEvent.type(searchbox(), 'zelda');
    await userEvent.click(await screen.findByRole('button', { name: 'Escolher Game 2 (2002)' }, { timeout: 3000 }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ igdbId: 2, name: 'Game 2' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('shows the games already in the list but will not choose them twice', async () => {
    const onPick = vi.fn();
    render(<Harness taken={[1]} onPick={onPick} />);
    await openIt();
    await userEvent.type(searchbox(), 'zelda');
    const taken = await screen.findByRole('button', { name: 'Game 1 (2001) já está na lista' }, { timeout: 3000 });
    expect(taken).toBeDisabled();
    expect(within(taken).getByText('Na lista')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Escolher Game 2 (2002)' })).toBeEnabled();
    expect(onPick).not.toHaveBeenCalled();
  });

  it('starts every opening with an empty search', async () => {
    render(<Harness />);
    await openIt();
    await userEvent.type(searchbox(), 'zelda');
    await results();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openIt();
    expect(searchbox()).toHaveValue('');
    expect(screen.getByText('Digite pelo menos 2 letras para buscar.')).toBeInTheDocument();
  });

  it('keeps a game without a cover findable, in a box of the same size', async () => {
    render(<Harness />);
    await openIt();
    await userEvent.type(searchbox(), 'zelda');
    const row = await screen.findByRole('button', { name: 'Escolher Game 3' }, { timeout: 3000 });
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('span[aria-hidden]')).toHaveClass('aspect-[264/352]');
  });

  it('says when nothing was found', async () => {
    search.mockResolvedValue({ games: [] });
    render(<Harness />);
    await openIt();
    await userEvent.type(searchbox(), '  qqq  ');
    expect(await screen.findByText('Nenhum jogo encontrado para “qqq”.', undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it('offers to try again after a busy or failed search, never for an unavailable service', async () => {
    search.mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'slow'));
    render(<Harness />);
    await openIt();
    await userEvent.type(searchbox(), 'zelda');
    expect(await screen.findByRole('alert', undefined, { timeout: 3000 })).toHaveTextContent('Muitas buscas ao mesmo tempo. Tente de novo em instantes.');
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await results()).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('says the service is unavailable without a button that would only hit it again', async () => {
    search.mockRejectedValue(new ApiError(503, 'games_unavailable', 'off'));
    render(<Harness />);
    await openIt();
    await userEvent.type(searchbox(), 'zelda');
    expect(await screen.findByRole('alert', undefined, { timeout: 3000 })).toHaveTextContent('A busca de jogos está indisponível no momento.');
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it('is operable with the keyboard alone', async () => {
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await openIt();
    const user = userEvent.setup();
    await user.keyboard('zelda');
    await screen.findByRole('list', { name: 'Resultados da busca' }, { timeout: 3000 });
    await user.tab();
    expect(screen.getByRole('button', { name: 'Escolher Game 1 (2001)' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onPick).toHaveBeenCalled());
  });

  it('is shown in English too', async () => {
    const { i18n } = await import('@/shared/i18n/init');
    await i18n.changeLanguage('en-US');
    try {
      render(<Harness />);
      const dialog = await openIt();
      expect(within(dialog).getByRole('heading', { name: 'Choose a game' })).toBeInTheDocument();
      expect(screen.getByRole('searchbox', { name: 'Search for a game' })).toBeInTheDocument();
    } finally { await i18n.changeLanguage('pt-BR'); }
  });
});

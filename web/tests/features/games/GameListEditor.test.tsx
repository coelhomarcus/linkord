import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameListEditor } from '@/features/games/GameListEditor';
import * as api from '@/features/games/gamesApi';
import { clearGameSearchCache } from '@/features/games/useGameSearch';
import type { GameItem, GameList } from '@/features/games/types';
import { ApiError } from '@/shared/api/api';
import { game } from './fixtures';

vi.mock('@/features/games/gamesApi', () => ({ searchGames: vi.fn() }));
const search = vi.mocked(api.searchGames);
beforeEach(() => { clearGameSearchCache(); search.mockReset(); search.mockResolvedValue({ games: [game(1), game(2), game(3, { coverImageId: null, imageUrl: null, releaseYear: null })] }); });

/** Keeps the list the way the Wall does, and exposes the latest value. */
function Harness({ list = 'liked', initial = [], onList }: { list?: GameList; initial?: GameItem[]; onList?: (games: GameItem[]) => void }) {
  const [games, setGames] = useState(initial);
  return <GameListEditor list={list} games={games} disabled={false} onChange={(next) => { setGames(next); onList?.(next); }} />;
}
const type = async (text: string) => userEvent.type(screen.getByRole('searchbox', { name: 'Buscar jogo' }), text);
const results = () => screen.findByRole('list', { name: 'Resultados da busca' }, { timeout: 3000 });

describe('game list editor', () => {
  it('waits for the typing to stop, then lists each game by name and year with its cover', async () => {
    render(<Harness />);
    expect(screen.getByText('Digite pelo menos 2 letras para buscar.')).toBeInTheDocument();
    await type('zelda');
    expect(screen.getByRole('status')).toHaveTextContent('Buscando jogos…');
    expect(search).not.toHaveBeenCalled();
    const list = await results();
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith('zelda', expect.any(AbortSignal));
    expect(within(list).getByRole('button', { name: 'Adicionar Game 1 (2001)' })).toBeInTheDocument();
    // the year is part of the name, but a game with no year is just its name
    expect(within(list).getByRole('button', { name: 'Adicionar Game 3' })).toBeInTheDocument();
    expect(list.querySelectorAll('img')).toHaveLength(2);
    expect(list.querySelector('img')).toHaveAttribute('alt', '');
  });

  it('does not search for one character', async () => {
    render(<Harness />);
    await type('z');
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(search).not.toHaveBeenCalled();
    expect(screen.getByText('Digite pelo menos 2 letras para buscar.')).toBeInTheDocument();
  });

  it('adds a game, marks it as in the list and will not add it twice', async () => {
    const onList = vi.fn();
    render(<Harness onList={onList} />);
    await type('zelda');
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Game 1 (2001)' }, { timeout: 3000 }));
    expect(onList).toHaveBeenLastCalledWith([expect.objectContaining({ igdbId: 1 })]);
    expect(screen.getByText('1 de 8')).toBeInTheDocument();
    const again = screen.getByRole('button', { name: 'Game 1 (2001) já está na lista' });
    expect(again).toBeDisabled();
    expect(within(screen.getByRole('list', { name: 'Jogos escolhidos: Jogos que eu gosto' })).getByText('Game 1')).toBeInTheDocument();
  });

  it('shows a picked game with the big cover its widget needs', async () => {
    const onList = vi.fn();
    render(<Harness onList={onList} />);
    await type('zelda');
    await userEvent.click(await screen.findByRole('button', { name: 'Adicionar Game 2 (2002)' }, { timeout: 3000 }));
    expect(onList.mock.lastCall![0][0].imageUrl).toBe('https://images.igdb.com/igdb/image/upload/t_cover_big/co2.jpg');
  });

  it('stops at the limit of the list and says why', async () => {
    const full = Array.from({ length: 8 }, (_, i) => game(i + 10));
    render(<Harness initial={full} />);
    await type('zelda');
    await results();
    expect(screen.getByText('A lista está cheia (8 jogos). Remova um jogo para adicionar outro.')).toBeInTheDocument();
    for (const button of within(screen.getByRole('list', { name: 'Resultados da busca' })).getAllByRole('button')) expect(button).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Remover Game 10 (2010)' }));
    expect(screen.getByRole('button', { name: 'Adicionar Game 1 (2001)' })).toBeEnabled();
  });

  it('replaces the favorite instead of adding a second one', async () => {
    const onList = vi.fn();
    render(<Harness list="favorite" initial={[game(9)]} onList={onList} />);
    expect(screen.getByText('1 de 1')).toBeInTheDocument();
    await type('zelda');
    // a list of one is never "full": picking another game swaps it
    await userEvent.click(await screen.findByRole('button', { name: 'Escolher Game 2 (2002) como favorito' }, { timeout: 3000 }));
    expect(onList).toHaveBeenLastCalledWith([expect.objectContaining({ igdbId: 2 })]);
    expect(onList.mock.lastCall![0]).toHaveLength(1);
    expect(screen.queryByText('Game 9')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mover/ })).not.toBeInTheDocument();
  });

  it('reorders and removes the games, each button named after its game', async () => {
    const onList = vi.fn();
    render(<Harness initial={[game(1), game(2), game(3)]} onList={onList} />);
    expect(screen.getByRole('button', { name: 'Mover Game 1 (2001) para cima' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mover Game 3 (2003) para baixo' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Mover Game 3 (2003) para cima' }));
    expect(onList.mock.lastCall![0].map((item: GameItem) => item.igdbId)).toEqual([1, 3, 2]);
    await userEvent.click(screen.getByRole('button', { name: 'Remover Game 1 (2001)' }));
    expect(onList.mock.lastCall![0].map((item: GameItem) => item.igdbId)).toEqual([3, 2]);
    expect(screen.getByText('2 de 8')).toBeInTheDocument();
  });

  it('says when nothing was found, and when nothing is picked yet', async () => {
    search.mockResolvedValue({ games: [] });
    render(<Harness />);
    expect(screen.getByText('Nenhum jogo escolhido ainda.')).toBeInTheDocument();
    await type('  qqq  ');
    expect(await screen.findByText('Nenhum jogo encontrado para “qqq”.', undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it('keeps a game without a cover findable, in a box of the same size', async () => {
    render(<Harness />);
    await type('zelda');
    const row = (await screen.findByRole('button', { name: 'Adicionar Game 3' }, { timeout: 3000 }));
    expect(row.querySelector('img')).toBeNull();
    expect(row.querySelector('span[aria-hidden]')).toHaveClass('aspect-[2/3]');
  });

  it('offers to try again after a busy or failed search, never for an unavailable service', async () => {
    search.mockRejectedValueOnce(new ApiError(429, 'rate_limited', 'slow'));
    render(<Harness />);
    await type('zelda');
    expect(await screen.findByRole('alert', undefined, { timeout: 3000 })).toHaveTextContent('Muitas buscas ao mesmo tempo. Tente de novo em instantes.');
    expect(search).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await results()).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('says the service is unavailable without a button that would only hit it again', async () => {
    search.mockRejectedValue(new ApiError(503, 'games_unavailable', 'off'));
    render(<Harness />);
    await type('zelda');
    expect(await screen.findByRole('alert', undefined, { timeout: 3000 })).toHaveTextContent('A busca de jogos está indisponível no momento.');
    expect(screen.queryByRole('button', { name: 'Tentar de novo' })).not.toBeInTheDocument();
  });

  it('is reachable and operable with the keyboard alone', async () => {
    const onList = vi.fn();
    render(<Harness onList={onList} />);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole('searchbox', { name: 'Buscar jogo' })).toHaveFocus();
    await user.keyboard('zelda');
    await screen.findByRole('list', { name: 'Resultados da busca' }, { timeout: 3000 });
    await user.tab();
    expect(screen.getByRole('button', { name: 'Adicionar Game 1 (2001)' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onList).toHaveBeenCalled());
  });

  it('is shown in English too', async () => {
    const { i18n } = await import('@/shared/i18n/init');
    await i18n.changeLanguage('en-US');
    try {
      render(<Harness list="wishlist" />);
      expect(screen.getByRole('heading', { name: 'Want to play' })).toBeInTheDocument();
      expect(screen.getByRole('searchbox', { name: 'Search for a game' })).toBeInTheDocument();
    } finally { await i18n.changeLanguage('pt-BR'); }
  });
});

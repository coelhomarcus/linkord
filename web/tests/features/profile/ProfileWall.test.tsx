import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ProfileWall } from '@/features/profile/ProfileWall';
import { WallWidgetCard } from '@/features/profile/WallWidgetCard';
import * as api from '@/features/profile/profileApi';
import * as gamesApi from '@/features/games/gamesApi';
import { clearGameSearchCache } from '@/features/games/useGameSearch';
import type { GameItem } from '@/features/games/types';
import { game } from '../games/fixtures';
import type { ProfileConnection, WallResponse, WallWidget } from '@/features/profile/connectionsTypes';

vi.mock('@/features/profile/profileApi', () => ({ fetchWall: vi.fn(), saveWall: vi.fn() }));
vi.mock('@/features/games/gamesApi', () => ({ searchGames: vi.fn() }));
const mocked = vi.mocked(api);
const searchGames = vi.mocked(gamesApi.searchGames);
const connection: ProfileConnection = { id: 'mal', provider: 'myanimelist', value: 'Xinil', url: 'https://myanimelist.net/profile/Xinil', position: 0, showOnProfile: true, syncedAt: '2026-11-05T12:00:00Z', syncError: null, status: 'ready' };
const anime: WallWidget = { connection, type: 'mal-recent-anime', data: { kind: 'list', items: [{ id: '1', title: 'Cowboy Bebop', url: 'https://myanimelist.net/anime/1', imageUrl: null }] } };
const profile: WallWidget = { connection: { ...connection, id: 'gh', provider: 'github', value: 'octocat', url: 'https://github.com/octocat' }, type: 'github-profile', data: { kind: 'github-profile', login: 'octocat', name: null, avatarUrl: null, repositories: 1, followers: 2, following: 3 } };
const empty: WallResponse = { widgets: [], available: [anime, profile] };
beforeEach(() => { vi.clearAllMocks(); mocked.fetchWall.mockResolvedValue(empty); });
function renderWall(owner = true) { render(<MemoryRouter><ProfileWall userId="me" owner={owner} accent="#3366ff" onNavigate={vi.fn()} /></MemoryRouter>); }

describe('profile Wall', () => {
  it('starts empty and keeps available data unpublished until explicitly saved', async () => {
    const user = userEvent.setup(); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    expect(screen.queryByRole('link', { name: 'Cowboy Bebop' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Atividade recente de animes' }));
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(mocked.saveWall).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('link', { name: 'Cowboy Bebop' })).not.toBeInTheDocument();
    expect(mocked.saveWall).not.toHaveBeenCalled();
  });
  it('adds, reorders and saves only connection references, then supports removing widgets', async () => {
    const user = userEvent.setup(); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    await user.click(screen.getByRole('button', { name: 'Atividade recente de animes' }));
    await user.click(screen.getByRole('button', { name: 'Perfil do GitHub' }));
    expect(screen.getByRole('button', { name: 'Mover Atividade recente de animes para cima' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Mover Perfil do GitHub para cima' }));
    const references = [{ connectionId: 'gh', type: 'github-profile' }, { connectionId: 'mal', type: 'mal-recent-anime' }];
    mocked.saveWall.mockResolvedValue({ ...empty, widgets: [profile, anime] });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalledWith(references));
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    await user.click(screen.getByRole('button', { name: 'Remover Atividade recente de animes' }));
    expect(screen.queryByRole('link', { name: 'Cowboy Bebop' })).not.toBeInTheDocument();
  });
  it('shows published widgets to visitors without edit controls or the catalog', async () => {
    mocked.fetchWall.mockResolvedValue({ widgets: [anime] }); renderWall(false);
    expect(await screen.findByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar widget' })).not.toBeInTheDocument();
    expect(screen.queryByText('Adicionar widget')).not.toBeInTheDocument();
    expect(mocked.fetchWall).toHaveBeenCalledWith('me', false, expect.any(AbortSignal));
  });
  it('preserves the editable draft when saving fails', async () => {
    const user = userEvent.setup(); mocked.saveWall.mockRejectedValue(new Error('offline')); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    await user.click(screen.getByRole('button', { name: 'Atividade recente de animes' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar o Mural.');
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });
  it('offers a retry after a failed initial load and renders an empty visitor Wall', async () => {
    const user = userEvent.setup(); mocked.fetchWall.mockRejectedValueOnce(new Error('offline')); renderWall(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o Mural.');
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Este usuário ainda não publicou widgets no Mural.')).toBeInTheDocument();
  });
});

describe('Wall widget cards', () => {
  it('distinguishes pending and unavailable data and keeps stale cached data visible', () => {
    const { rerender } = render(<WallWidgetCard widget={{ ...anime, data: null, connection: { ...connection, syncedAt: null } }} accent="#3366ff" />);
    expect(screen.getByRole('status')).toHaveTextContent('Os dados aparecerão após a primeira sincronização.');
    rerender(<WallWidgetCard widget={{ ...anime, data: null, connection: { ...connection, syncError: 'private' } }} accent="#3366ff" />);
    expect(screen.getByRole('status')).toHaveTextContent('Não foi possível carregar os dados deste widget.');
    rerender(<WallWidgetCard widget={{ ...anime, connection: { ...connection, syncError: 'unavailable' } }} accent="#3366ff" />);
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(screen.getByText(/A última sincronização falhou/)).toBeInTheDocument();
    expect(screen.queryByText(/Atualizado em/)).not.toBeInTheDocument();
  });
  it('names the profile link with the service and the user, and keeps the logo out of that name', () => {
    render(<WallWidgetCard widget={anime} accent="#3366ff" />);
    const link = screen.getByRole('link', { name: 'MyAnimeList, @Xinil' });
    expect(link).toHaveAttribute('href', connection.url);
    expect(link).not.toHaveTextContent('MyAnimeList');
    expect(screen.getByRole('heading', { name: 'Atividade recente de animes' })).toBeInTheDocument();
  });
  it('groups widgets still off the Wall by service, with the account named once', async () => {
    const user = userEvent.setup();
    renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    expect(screen.getByRole('heading', { name: 'MyAnimeList' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByText('@Xinil')).toBeInTheDocument();
    expect(screen.getByText('@octocat')).toBeInTheDocument();
    expect(screen.queryByText(/GitHub ·/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Atividade recente de animes' })).toBeInTheDocument();
  });
  it('shows only the covers of the first eight recent anime, without titles or progress', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: `Anime ${i}`, url: `https://myanimelist.net/anime/${i}`, imageUrl: `https://cdn.myanimelist.net/${i}.jpg` }));
    render(<WallWidgetCard widget={{ ...anime, data: { kind: 'list', items } }} accent="#3366ff" />);
    expect(screen.getAllByRole('link', { name: /^Anime / })).toHaveLength(8);
    expect(screen.queryByRole('link', { name: 'Anime 8' })).not.toBeInTheDocument();
    expect(screen.queryByText('Anime 0')).not.toBeInTheDocument();
  });
  it('renders a contribution calendar with localized day descriptions', () => {
    render(<WallWidgetCard widget={{ connection: { ...connection, provider: 'github' }, type: 'github-calendar', data: { kind: 'github-calendar', total: 4, days: [{ date: '2026-11-01', count: 4, level: 3 }] } }} accent="#3366ff" />);
    expect(screen.getByRole('group', { name: 'Calendário de contribuições do GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /4 contribuições/ })).toBeInTheDocument();
    expect(screen.getByText('4 contribuições nos últimos 12 meses')).toBeInTheDocument();
  });
  it('draws the calendar with the profile accent, and leaves empty days neutral', () => {
    const days = [{ date: '2026-11-01', count: 0, level: 0 }, { date: '2026-11-02', count: 9, level: 4 }];
    render(<WallWidgetCard widget={{ connection: { ...connection, provider: 'github' }, type: 'github-calendar', data: { kind: 'github-calendar', total: 9, days } }} accent="#ff8800" />);
    const [empty, busiest] = screen.getAllByRole('img');
    expect(busiest).toHaveStyle({ backgroundColor: '#ff8800' });
    expect(busiest).not.toHaveClass('bg-primary');
    expect(empty).toHaveClass('bg-fill-hover');
    expect(empty.getAttribute('style')).toBeNull();
  });
  it('keeps only the most recent weeks that fit the calendar width', () => {
    const days = Array.from({ length: 70 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 4 + i)).toISOString().slice(0, 10), count: i, level: 1 }));
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 36 } as DOMRect);
    // 3 weeks fit: 3 * 10px cells + 2 * 3px gaps
    try {
      render(<WallWidgetCard widget={{ connection: { ...connection, provider: 'github' }, type: 'github-calendar', data: { kind: 'github-calendar', total: 4, days } }} accent="#3366ff" />);
      const cells = screen.getAllByRole('img');
      expect(cells).toHaveLength(21);
      expect(cells[0]).toHaveAccessibleName(/49 contribuições/);
      expect(cells.at(-1)).toHaveAccessibleName(/69 contribuições/);
    } finally {
      rect.mockRestore();
    }
  });
});

const gameWidget = (type: 'igdb-favorite-game' | 'igdb-liked-games' | 'igdb-playing-games' | 'igdb-wishlist-games', items: GameItem[] = []): WallWidget => ({ connection: null, type, data: { kind: 'games', items } });
const gameChoices = [gameWidget('igdb-favorite-game'), gameWidget('igdb-liked-games'), gameWidget('igdb-playing-games'), gameWidget('igdb-wishlist-games')];
// like the server, `available` holds the same data as the widgets already on the Wall
const withAvailable = (...widgets: WallWidget[]): WallResponse => ({ widgets, available: gameChoices.map((choice) => widgets.find((widget) => widget.type === choice.type) ?? choice) });
const names = { favorite: 'Jogo favorito', liked: 'Jogos que eu gosto', playing: 'Jogos em rotação', wishlist: 'Quero jogar' };

describe('games widgets on the Wall', () => {
  beforeEach(() => { clearGameSearchCache(); searchGames.mockReset(); searchGames.mockResolvedValue({ games: [game(1), game(2)] }); });

  it('offers all four to someone with no connections, under IGDB', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: gameChoices }); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    expect(screen.getByRole('heading', { name: 'IGDB' })).toBeInTheDocument();
    for (const name of Object.values(names)) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
    expect(screen.queryByText('Conecte MyAnimeList ou GitHub para liberar widgets.')).not.toBeInTheDocument();
  });

  it('picks a favorite, saves the connections-free selection together with the snapshot, and nothing else', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: [...gameChoices, anime] }); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    await user.click(screen.getByRole('button', { name: names.favorite }));
    // adding the widget opens its game picker
    await user.type(screen.getByRole('searchbox', { name: 'Buscar jogo' }), 'zelda');
    await user.click(await screen.findByRole('button', { name: 'Escolher Game 1 (2001) como favorito' }, { timeout: 3000 }));
    expect(screen.getByRole('link', { name: 'Game 1' })).toHaveAttribute('href', 'https://www.igdb.com/games/game-1');
    mocked.saveWall.mockResolvedValue({ widgets: [gameWidget('igdb-favorite-game', [game(1)])], available: gameChoices });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalledWith(
      [{ connectionId: null, type: 'igdb-favorite-game' }],
      { favorite: [expect.objectContaining({ igdbId: 1 })] },
    ));
    expect(mocked.saveWall.mock.calls[0]![1]!.favorite![0]).toHaveProperty('igdbId', 1);
    // the search result is not what is stored: the server builds the link and the cover
    expect(mocked.saveWall.mock.calls[0]![0]).toEqual([{ connectionId: null, type: 'igdb-favorite-game' }]);
  });

  it('sends only the lists that were edited, and nothing when none was', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue(withAvailable(gameWidget('igdb-liked-games', [game(5)]), gameWidget('igdb-wishlist-games', [game(6)]))); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    mocked.saveWall.mockResolvedValue({ widgets: [], available: gameChoices });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalledWith([{ connectionId: null, type: 'igdb-liked-games' }, { connectionId: null, type: 'igdb-wishlist-games' }]));
    expect(mocked.saveWall.mock.calls[0]).toHaveLength(1);
  });

  it('edits the games of a widget already on the Wall: remove one, reorder, save', async () => {
    const user = userEvent.setup();
    const liked = gameWidget('igdb-liked-games', [game(5), game(6), game(7)]);
    mocked.fetchWall.mockResolvedValue(withAvailable(liked)); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    const toggle = screen.getByRole('button', { name: 'Escolher jogos: Jogos que eu gosto' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Fechar: Jogos que eu gosto' })).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: 'Remover Game 5 (2005)' }));
    await user.click(screen.getByRole('button', { name: 'Mover Game 7 (2007) para cima' }));
    expect(screen.getAllByRole('link', { name: /^Game / }).map((link) => link.getAttribute('aria-label'))).toEqual(['Game 7', 'Game 6']);
    mocked.saveWall.mockResolvedValue({ widgets: [], available: gameChoices });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalled());
    expect(mocked.saveWall.mock.calls[0]![1]!.liked!.map((item) => item.igdbId)).toEqual([7, 6]);
  });

  it('forgets the unsaved picks on cancel', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue(withAvailable(gameWidget('igdb-liked-games', [game(5)]))); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    await user.click(screen.getByRole('button', { name: 'Escolher jogos: Jogos que eu gosto' }));
    await user.click(screen.getByRole('button', { name: 'Remover Game 5 (2005)' }));
    expect(screen.queryByRole('link', { name: 'Game 5' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('link', { name: 'Game 5' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar widget' }));
    expect(screen.getByRole('link', { name: 'Game 5' })).toBeInTheDocument();
    expect(mocked.saveWall).not.toHaveBeenCalled();
  });

  it('keeps the picks when saving fails', async () => {
    const user = userEvent.setup(); mocked.saveWall.mockRejectedValue(new Error('offline'));
    mocked.fetchWall.mockResolvedValue(withAvailable(gameWidget('igdb-liked-games', [game(5)]))); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Adicionar widget' }));
    await user.click(screen.getByRole('button', { name: 'Escolher jogos: Jogos que eu gosto' }));
    await user.click(screen.getByRole('button', { name: 'Remover Game 5 (2005)' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar o Mural.');
    expect(screen.queryByRole('link', { name: 'Game 5' })).not.toBeInTheDocument();
  });

  it('shows visitors the games without any editing', async () => {
    mocked.fetchWall.mockResolvedValue({ widgets: [gameWidget('igdb-favorite-game', [game(1)]), gameWidget('igdb-liked-games', [game(2), game(3)])] }); renderWall(false);
    expect(await screen.findByRole('heading', { name: 'Jogo favorito' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Game 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Escolher jogos/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  });
});

describe('games widget cards', () => {
  const render1 = (widget: WallWidget) => render(<WallWidgetCard widget={widget} accent="#3366ff" />);
  it('shows the favorite large, with its name and year beside the cover', () => {
    render1(gameWidget('igdb-favorite-game', [game(1, { imageUrl: 'https://images.igdb.com/big.jpg' })]));
    expect(screen.getByText('Game 1')).toBeInTheDocument();
    expect(screen.getByText('2001')).toBeInTheDocument();
    const cover = screen.getByRole('link', { name: 'Game 1' });
    expect(cover).toHaveAttribute('href', 'https://www.igdb.com/games/game-1');
    expect(cover).toHaveAttribute('target', '_blank');
    expect(cover).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    expect(cover.querySelector('img')).toHaveAttribute('src', 'https://images.igdb.com/big.jpg');
    expect(screen.getByRole('link', { name: 'IGDB, fonte dos dados dos jogos' })).toHaveAttribute('href', 'https://www.igdb.com');
  });
  it('shows a list as the grid of covers, eight at most', () => {
    render1(gameWidget('igdb-playing-games', Array.from({ length: 10 }, (_, i) => game(i + 1))));
    expect(screen.getAllByRole('link', { name: /^Game / })).toHaveLength(8);
    expect(screen.getByRole('heading', { name: 'Jogos em rotação' })).toBeInTheDocument();
  });
  it('says what a game is when it has no cover, and when nothing was chosen', () => {
    const { rerender } = render1(gameWidget('igdb-wishlist-games', [game(4, { imageUrl: null, coverImageId: null })]));
    expect(screen.getByRole('link', { name: 'Game 4' }).querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: 'Game 4' })).toHaveTextContent('Game 4');
    rerender(<WallWidgetCard widget={gameWidget('igdb-wishlist-games')} accent="#3366ff" />);
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum jogo escolhido ainda.');
    rerender(<WallWidgetCard widget={gameWidget('igdb-favorite-game')} accent="#3366ff" />);
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum jogo escolhido ainda.');
  });
});

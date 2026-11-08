import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ProfileWall } from '@/features/profile/ProfileWall';
import { WallWidgetCard } from '@/features/profile/WallWidgetCard';
import * as api from '@/features/profile/profileApi';
import { ApiError } from '@/shared/api/api';
import * as gamesApi from '@/features/games/gamesApi';
import { clearGameSearchCache } from '@/features/games/useGameSearch';
import type { GameItem } from '@/features/games/types';
import { game } from '../games/fixtures';
import type { ProfileConnection, WallResponse, WallWidget } from '@/features/profile/connectionsTypes';

vi.mock('@/features/profile/profileApi', () => ({ fetchWall: vi.fn(), saveWall: vi.fn(), createConnection: vi.fn() }));
vi.mock('@/features/games/gamesApi', () => ({ searchGames: vi.fn() }));
const mocked = vi.mocked(api);
const searchGames = vi.mocked(gamesApi.searchGames);
const connection: ProfileConnection = { id: 'mal', provider: 'myanimelist', value: 'Xinil', url: 'https://myanimelist.net/profile/Xinil', position: 0, showOnProfile: true, syncedAt: '2026-11-05T12:00:00Z', syncError: null, status: 'ready' };
const anime: WallWidget = { connection, type: 'mal-recent-anime', data: { kind: 'list', items: [{ id: '1', title: 'Cowboy Bebop', url: 'https://myanimelist.net/anime/1', imageUrl: null }] } };
const profile: WallWidget = { connection: { ...connection, id: 'gh', provider: 'github', value: 'octocat', url: 'https://github.com/octocat' }, type: 'github-profile', data: { kind: 'github-profile', login: 'octocat', name: null, avatarUrl: null, repositories: 1, followers: 2, following: 3 } };
const empty: WallResponse = { widgets: [], available: [anime, profile] };
beforeEach(() => { vi.clearAllMocks(); mocked.fetchWall.mockResolvedValue(empty); });
function renderWall(owner = true) { render(<MemoryRouter><ProfileWall userId="me" owner={owner} accent="#3366ff" onNavigate={vi.fn()} /></MemoryRouter>); }

const gameWidget = (type: 'igdb-favorite-game' | 'igdb-liked-games' | 'igdb-playing-games' | 'igdb-wishlist-games', items: GameItem[] = []): WallWidget => ({ connection: null, type, data: { kind: 'games', items } });
const gameChoices = [gameWidget('igdb-favorite-game'), gameWidget('igdb-liked-games'), gameWidget('igdb-playing-games'), gameWidget('igdb-wishlist-games')];
// like the server, `available` holds the same data as the widgets already on the Wall
const withAvailable = (widgets: WallWidget[], extra: WallWidget[] = []): WallResponse => ({ widgets, available: [...extra, ...gameChoices.map((choice) => widgets.find((widget) => widget.type === choice.type) ?? choice)] });
const names = { favorite: 'Jogo favorito', liked: 'Jogos que eu gosto', playing: 'Jogos em rotação', wishlist: 'Quero jogar' };
const addWidgetButton = () => screen.findByRole('button', { name: 'Adicionar widget' });
// the window opens on the games; the other widgets are under their own group
const GROUP_OF: Record<string, string> = { 'Atividade recente de animes': 'Anime', 'Perfil do GitHub': 'GitHub', 'Contribuições no GitHub': 'GitHub' };
async function chooseWidget(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await addWidgetButton());
  const dialog = await screen.findByRole('dialog', { name: 'Adicionar widget de perfil' });
  if (GROUP_OF[name]) await user.click(within(dialog).getByRole('button', { name: GROUP_OF[name] }));
  await user.click(within(dialog).getByRole('button', { name }));
}
/** jsdom has no layout: place each widget row 200px below the previous one, so dragging with the keyboard has somewhere to go. */
function layOutRows() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const row = this.closest('[data-wall-widget]');
    const index = row ? Array.from(row.parentElement!.children).indexOf(row) : 0;
    const top = index * 200;
    return { x: 0, y: top, left: 0, top, width: 400, height: 180, right: 400, bottom: top + 180, toJSON: () => ({}) } as DOMRect;
  });
}
async function dragUp(user: ReturnType<typeof userEvent.setup>, name: string) {
  const handle = screen.getByRole('button', { name: `Reordenar ${name}` });
  handle.focus();
  await user.keyboard(' ');
  await user.keyboard('{ArrowUp}');
  await user.keyboard(' ');
}
const saveBar = () => screen.queryByRole('region', { name: 'Salvar alterações do Mural' });
describe('profile Wall', () => {
  it('holds the place of the widgets while the Wall loads, and tells screen readers', async () => {
    let resolve!: (value: WallResponse) => void;
    mocked.fetchWall.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderWall();

    // the drag-and-drop announcer is a status too
    const status = screen.getByText('Carregando Mural…');
    expect(status).toHaveAttribute('role', 'status');
    expect(status.closest('[aria-busy="true"]')!.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    // the header's button is already there, so the header does not grow when the Wall arrives
    expect(screen.getByRole('button', { name: 'Adicionar widget' })).toBeDisabled();

    resolve({ widgets: [anime], available: [anime, profile] });
    expect(await screen.findByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(screen.queryByText('Carregando Mural…')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Adicionar widget' })).toBeEnabled();
  });

  it('lets the owner edit without a mode to enter, and shows no save bar until something changes', async () => {
    mocked.fetchWall.mockResolvedValue({ widgets: [anime], available: [anime, profile, ...gameChoices] }); renderWall();
    expect(await addWidgetButton()).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover Atividade recente de animes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reordenar Atividade recente de animes' })).toBeInTheDocument();
    // no dashed frame and no arrow buttons any more: a handle to drag and a floating delete
    expect(screen.queryByRole('button', { name: /para cima|para baixo/ })).not.toBeInTheDocument();
    expect(saveBar()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
  });

  it('opens the catalog in a window with the groups beside the widgets, and nothing is added until one is chosen', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: [anime, profile, ...gameChoices] }); renderWall();
    await user.click(await addWidgetButton());
    const dialog = await screen.findByRole('dialog', { name: 'Adicionar widget de perfil' });
    const groups = within(within(dialog).getByRole('navigation', { name: 'Tipos de widget' }));
    expect(groups.getByRole('button', { name: 'Jogos' })).toHaveAttribute('aria-current', 'true');
    for (const name of Object.values(names)) expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
    await user.click(groups.getByRole('button', { name: 'Anime' }));
    expect(within(dialog).getByRole('button', { name: 'Atividade recente de animes' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: names.favorite })).not.toBeInTheDocument();
    await user.click(groups.getByRole('button', { name: 'GitHub' }));
    expect(within(dialog).getByRole('button', { name: 'Perfil do GitHub' })).toBeInTheDocument();
    expect(saveBar()).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Cowboy Bebop' })).not.toBeInTheDocument();
  });

  it('lists every kind of widget, with plain text groups, even with no connection at all', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: gameChoices }); renderWall();
    await user.click(await addWidgetButton());
    const dialog = await screen.findByRole('dialog');
    const nav = within(dialog).getByRole('navigation', { name: 'Tipos de widget' });
    expect(within(nav).getAllByRole('button').map((button) => button.textContent)).toEqual(['Jogos', 'Anime', 'GitHub', 'Gerenciar conexões']);
    expect(nav.querySelector('svg')).toBeNull();
    for (const name of Object.values(names)) expect(within(dialog).getByRole('button', { name })).toBeInTheDocument();
    // a service with no account shows its widgets, locked, under a form to connect it
    await user.click(within(nav).getByRole('button', { name: 'GitHub' }));
    expect(within(dialog).getByText('Conecte sua conta do GitHub')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Perfil do GitHub' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Contribuições no GitHub' })).toBeDisabled();
  });

  it('connects an account from the window, and its widgets become choosable there', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: gameChoices }); renderWall();
    const changed = vi.fn(); window.addEventListener('profile-connections-changed', changed);
    await user.click(await addWidgetButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Anime' }));
    mocked.createConnection.mockResolvedValue({ connections: [] });
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: [anime, ...gameChoices] });
    await user.type(within(dialog).getByLabelText('Nome de usuário'), 'Xinil');
    await user.click(within(dialog).getByRole('button', { name: 'Conectar' }));
    expect(mocked.createConnection).toHaveBeenCalledWith('myanimelist', 'Xinil');
    expect(await within(dialog).findByRole('button', { name: 'Atividade recente de animes' })).toBeEnabled();
    expect(within(dialog).queryByText('Conecte sua conta do MyAnimeList')).not.toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
    window.removeEventListener('profile-connections-changed', changed);
    await user.click(within(dialog).getByRole('button', { name: 'Atividade recente de animes' }));
    expect(await screen.findByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
  });

  it('says why an account could not be connected, and keeps the form', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: gameChoices }); renderWall();
    await user.click(await addWidgetButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'GitHub' }));
    mocked.createConnection.mockRejectedValue(new ApiError(400, 'invalid_connection', 'x'));
    await user.type(within(dialog).getByLabelText('Nome de usuário'), 'bad--name');
    await user.click(within(dialog).getByRole('button', { name: 'Conectar' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Informe uma URL http/https válida ou um nome de usuário válido para o serviço.');
    expect(within(dialog).getByRole('button', { name: 'Conectar' })).toBeEnabled();
  });

  it('keeps a widget already on the Wall in the catalog, marked as added and not choosable', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue(withAvailable([gameWidget('igdb-liked-games')])); renderWall();
    await user.click(await addWidgetButton());
    const added = await screen.findByRole('button', { name: names.liked });
    expect(added).toBeDisabled();
    expect(within(added).getByText('Adicionado')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: names.favorite })).toBeEnabled();
  });

  it('adds a widget, closes the window, and raises the floating bar over the profile', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: [anime, profile] }); renderWall();
    await chooseWidget(user, 'Atividade recente de animes');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    const bar = saveBar()!;
    expect(within(bar).getByText('Não se esqueça de salvar suas alterações!')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Redefinir' })).toBeEnabled();
    expect(within(bar).getByRole('button', { name: 'Salvar' })).toBeEnabled();
    expect(mocked.saveWall).not.toHaveBeenCalled();
    // there is no Cancel / Save pair at the end of the Wall any more
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });

  it('puts the saved Wall back with Reset, and the bar goes away', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [anime], available: [anime, profile] }); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Remover Atividade recente de animes' }));
    expect(screen.queryByRole('link', { name: 'Cowboy Bebop' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Redefinir' }));
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(saveBar()).not.toBeInTheDocument();
    expect(mocked.saveWall).not.toHaveBeenCalled();
  });

  it('adds, reorders and saves only connection references, then supports removing widgets', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: [anime, profile] }); renderWall();
    await chooseWidget(user, 'Atividade recente de animes');
    await chooseWidget(user, 'Perfil do GitHub');
    const rows = layOutRows();
    await dragUp(user, 'Perfil do GitHub');
    rows.mockRestore();
    const references = [{ connectionId: 'gh', type: 'github-profile' }, { connectionId: 'mal', type: 'mal-recent-anime' }];
    mocked.saveWall.mockResolvedValue({ widgets: [profile, anime], available: [anime, profile] });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalledWith(references));
    await waitFor(() => expect(saveBar()).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Remover Atividade recente de animes' }));
    expect(screen.queryByRole('link', { name: 'Cowboy Bebop' })).not.toBeInTheDocument();
  });

  it('saves a reordering of the widgets already there', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [anime, profile], available: [anime, profile] }); renderWall();
    await screen.findByRole('button', { name: 'Reordenar Perfil do GitHub' });
    const rows = layOutRows();
    await dragUp(user, 'Perfil do GitHub');
    rows.mockRestore();
    expect(saveBar()).toBeInTheDocument();
    mocked.saveWall.mockResolvedValue({ widgets: [profile, anime], available: [anime, profile] });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalledWith([{ connectionId: 'gh', type: 'github-profile' }, { connectionId: 'mal', type: 'mal-recent-anime' }]));
  });

  it('leaves the order alone when a drag is cancelled with Escape', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [anime, profile], available: [anime, profile] }); renderWall();
    const handle = await screen.findByRole('button', { name: 'Reordenar Perfil do GitHub' });
    const rows = layOutRows();
    handle.focus();
    await user.keyboard(' ');
    await user.keyboard('{ArrowUp}');
    await user.keyboard('{Escape}');
    rows.mockRestore();
    expect(saveBar()).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(expect.arrayContaining(['Atividade recente de animes', 'Perfil do GitHub']));
  });

  it('shows published widgets to visitors without edit controls, catalog or bar', async () => {
    mocked.fetchWall.mockResolvedValue({ widgets: [anime] }); renderWall(false);
    expect(await screen.findByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar widget' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remover|Mover|Reordenar/ })).not.toBeInTheDocument();
    expect(saveBar()).not.toBeInTheDocument();
    expect(mocked.fetchWall).toHaveBeenCalledWith('me', false, expect.any(AbortSignal));
  });

  it('preserves the draft and the bar when saving fails', async () => {
    const user = userEvent.setup(); mocked.saveWall.mockRejectedValue(new Error('offline'));
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: [anime, profile] }); renderWall();
    await chooseWidget(user, 'Atividade recente de animes');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar o Mural.');
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Redefinir' })).toBeEnabled();
  });

  it('asks the browser to confirm leaving while there is something unsaved', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: [anime] }); renderWall();
    const leave = () => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; };
    await addWidgetButton();
    expect(leave()).toBe(false);
    await chooseWidget(user, 'Atividade recente de animes');
    expect(leave()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Redefinir' }));
    expect(leave()).toBe(false);
  });

  it('offers a retry after a failed initial load and renders an empty visitor Wall', async () => {
    const user = userEvent.setup(); mocked.fetchWall.mockRejectedValueOnce(new Error('offline')); renderWall(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o Mural.');
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Este usuário ainda não publicou widgets no Mural.')).toBeInTheDocument();
  });

  it('sends the manage-connections shortcut away from the window', async () => {
    const user = userEvent.setup();
    mocked.fetchWall.mockResolvedValue({ widgets: [], available: gameChoices }); renderWall();
    await user.click(await addWidgetButton());
    await user.click(await screen.findByRole('button', { name: 'Gerenciar conexões' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('games widgets on the Wall', () => {
  beforeEach(() => { clearGameSearchCache(); searchGames.mockReset(); searchGames.mockResolvedValue({ games: [game(1), game(2), game(3)] }); });
  const pickInDialog = async (user: ReturnType<typeof userEvent.setup>, name: string, text = 'zelda') => {
    await user.type(await screen.findByRole('searchbox', { name: 'Buscar jogo' }), text);
    await user.click(await screen.findByRole('button', { name }, { timeout: 3000 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  };
  const startWith = (response: WallResponse) => { mocked.fetchWall.mockResolvedValue(response); renderWall(); return userEvent.setup(); };

  it('shows a new games widget as empty places to fill, with no search open', async () => {
    const user = startWith({ widgets: [], available: gameChoices });
    await chooseWidget(user, names.liked);
    expect(screen.getAllByRole('button', { name: 'Adicionar jogo a Jogos que eu gosto' })).toHaveLength(8);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the games of a widget already on the Wall as editable covers, with no mode to enter', async () => {
    startWith(withAvailable([gameWidget('igdb-liked-games', [game(5)])]));
    expect(await screen.findByRole('button', { name: 'Trocar Game 5' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Adicionar jogo a Jogos que eu gosto' })).toHaveLength(7);
    expect(saveBar()).not.toBeInTheDocument();
  });

  it('fills a place by searching in a window over the page, and keeps the widget its size', async () => {
    const user = startWith({ widgets: [], available: gameChoices });
    await chooseWidget(user, names.liked);
    const before = screen.getAllByRole('listitem').length;
    await user.click(screen.getAllByRole('button', { name: 'Adicionar jogo a Jogos que eu gosto' })[0]!);
    expect(await screen.findByRole('dialog', { name: 'Escolher jogo' })).toBeInTheDocument();
    await pickInDialog(user, 'Escolher Game 2 (2002)');
    expect(screen.getByRole('button', { name: 'Trocar Game 2' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Adicionar jogo a Jogos que eu gosto' })).toHaveLength(7);
    // a game took the place of an empty one: the grid is still eight places
    expect(screen.getAllByRole('listitem').length).toBe(before);
  });

  it('picks a favorite, saves the connection-free selection with the snapshot, and nothing else', async () => {
    const user = startWith({ widgets: [], available: [...gameChoices, anime] });
    await chooseWidget(user, names.favorite);
    await user.click(screen.getByRole('button', { name: 'Adicionar jogo a Jogo favorito' }));
    await pickInDialog(user, 'Escolher Game 1 (2001)');
    expect(screen.getByText('Game 1')).toBeInTheDocument();
    mocked.saveWall.mockResolvedValue({ widgets: [gameWidget('igdb-favorite-game', [game(1)])], available: gameChoices });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalledWith(
      [{ connectionId: null, type: 'igdb-favorite-game' }],
      { favorite: [expect.objectContaining({ igdbId: 1 })] },
    ));
    expect(mocked.saveWall.mock.calls[0]![1]!.favorite).toHaveLength(1);
  });

  it('saves a change to the games alone with the widgets as they are', async () => {
    const user = startWith(withAvailable([gameWidget('igdb-liked-games', [game(5)]), gameWidget('igdb-wishlist-games', [game(6)])]));
    await user.click(await screen.findByRole('button', { name: 'Remover Game 5' }));
    mocked.saveWall.mockResolvedValue({ widgets: [], available: gameChoices });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalled());
    expect(mocked.saveWall.mock.calls[0]![0]).toEqual([{ connectionId: null, type: 'igdb-liked-games' }, { connectionId: null, type: 'igdb-wishlist-games' }]);
    expect(mocked.saveWall.mock.calls[0]![1]).toEqual({ liked: [] });
  });

  it('replaces a game in its own place, not at the end', async () => {
    const user = startWith(withAvailable([gameWidget('igdb-liked-games', [game(5), game(6), game(7)])]));
    await user.click(await screen.findByRole('button', { name: 'Trocar Game 6' }));
    await pickInDialog(user, 'Escolher Game 2 (2002)');
    mocked.saveWall.mockResolvedValue({ widgets: [], available: gameChoices });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalled());
    expect(mocked.saveWall.mock.calls[0]![1]!.liked!.map((item) => item.igdbId)).toEqual([5, 2, 7]);
  });

  it('swaps the favorite for another game', async () => {
    const user = startWith(withAvailable([gameWidget('igdb-favorite-game', [game(9)])]));
    await user.click(await screen.findByRole('button', { name: 'Trocar Game 9' }));
    await pickInDialog(user, 'Escolher Game 1 (2001)');
    mocked.saveWall.mockResolvedValue({ widgets: [], available: gameChoices });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalled());
    expect(mocked.saveWall.mock.calls[0]![1]!.favorite!.map((item) => item.igdbId)).toEqual([1]);
  });

  it('removes and reorders on the covers, and offers the freed place again', async () => {
    const user = startWith(withAvailable([gameWidget('igdb-liked-games', [game(5), game(6), game(7)])]));
    expect(await screen.findByRole('button', { name: 'Mover Game 5 para antes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mover Game 7 para depois' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Mover Game 7 para antes' }));
    await user.click(screen.getByRole('button', { name: 'Remover Game 5' }));
    expect(screen.getAllByRole('button', { name: 'Adicionar jogo a Jogos que eu gosto' })).toHaveLength(6);
    mocked.saveWall.mockResolvedValue({ widgets: [], available: gameChoices });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalled());
    expect(mocked.saveWall.mock.calls[0]![1]!.liked!.map((item) => item.igdbId)).toEqual([7, 6]);
  });

  it('does not let a game already in the list be chosen again', async () => {
    const user = startWith(withAvailable([gameWidget('igdb-liked-games', [game(1)])]));
    await user.click((await screen.findAllByRole('button', { name: 'Adicionar jogo a Jogos que eu gosto' }))[0]!);
    await user.type(await screen.findByRole('searchbox', { name: 'Buscar jogo' }), 'zelda');
    expect(await screen.findByRole('button', { name: 'Game 1 (2001) já está na lista' }, { timeout: 3000 })).toBeDisabled();
  });

  it('forgets the unsaved picks on Reset', async () => {
    const user = startWith(withAvailable([gameWidget('igdb-liked-games', [game(5)])]));
    await user.click(await screen.findByRole('button', { name: 'Remover Game 5' }));
    expect(screen.queryByRole('button', { name: 'Trocar Game 5' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Redefinir' }));
    expect(screen.getByRole('button', { name: 'Trocar Game 5' })).toBeInTheDocument();
    expect(saveBar()).not.toBeInTheDocument();
    expect(mocked.saveWall).not.toHaveBeenCalled();
  });

  it('keeps the picks when saving fails', async () => {
    mocked.saveWall.mockRejectedValue(new Error('offline'));
    const user = startWith(withAvailable([gameWidget('igdb-liked-games', [game(5)])]));
    await user.click(await screen.findByRole('button', { name: 'Remover Game 5' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar o Mural.');
    expect(screen.getAllByRole('button', { name: 'Adicionar jogo a Jogos que eu gosto' })).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  it('shows visitors the games as covers only: no controls, no empty places, no window', async () => {
    mocked.fetchWall.mockResolvedValue({ widgets: [gameWidget('igdb-favorite-game', [game(1)]), gameWidget('igdb-liked-games', [game(2), game(3)])] }); renderWall(false);
    expect(await screen.findByRole('heading', { name: 'Jogo favorito' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Game 3' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Adicionar jogo|Trocar|Remover/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
    // the service's mark sits inside the account badge, not before the title
    expect(link.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Atividade recente de animes' }).querySelector('svg')).toBeNull();
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
  it('draws the calendar with a lighter version of a profile colour too dark to read', () => {
    const days = [{ date: '2026-11-02', count: 9, level: 4 }];
    render(<WallWidgetCard widget={{ connection: { ...connection, provider: 'github' }, type: 'github-calendar', data: { kind: 'github-calendar', total: 9, days } }} accent="#000000" />);
    const busiest = screen.getByRole('img');
    expect(busiest).not.toHaveStyle({ backgroundColor: '#000000' });
    expect(busiest.style.backgroundColor).not.toBe('');
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

describe('games widget cards', () => {
  const render1 = (widget: WallWidget) => render(<WallWidgetCard widget={widget} accent="#3366ff" />);
  it('shows the favorite as one cover of a middle size, with its name and year beside it', () => {
    render1(gameWidget('igdb-favorite-game', [game(1, { imageUrl: 'https://images.igdb.com/big.jpg' })]));
    expect(screen.getByText('Game 1')).toBeInTheDocument();
    expect(screen.getByText('2001')).toBeInTheDocument();
    const cover = screen.getByRole('link', { name: 'Game 1' });
    expect(cover).toHaveAttribute('href', 'https://www.igdb.com/games/game-1');
    expect(cover).toHaveAttribute('target', '_blank');
    expect(cover).toHaveAttribute('rel', expect.stringContaining('noreferrer'));
    expect(cover.querySelector('img')).toHaveAttribute('src', 'https://images.igdb.com/big.jpg');
    expect(cover).toHaveClass('aspect-[264/352]');
    expect(cover.closest('ul')).toBeNull();
    // large enough to be the point of the widget, not so large it fills the card
    expect(cover.parentElement).toHaveClass('w-28', 'sm:w-32');
    // a games widget has no account behind it: no badge, and no logo before the title
    expect(screen.queryByRole('link', { name: /IGDB/ })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Jogo favorito' }).querySelector('svg')).toBeNull();
  });
  it('shows a list as a grid of covers, eight at most, all 264x352', () => {
    render1(gameWidget('igdb-playing-games', Array.from({ length: 10 }, (_, i) => game(i + 1))));
    expect(screen.getAllByRole('link', { name: /^Game / })).toHaveLength(8);
    expect(screen.getByRole('heading', { name: 'Jogos em rotação' })).toBeInTheDocument();
    for (const link of screen.getAllByRole('link', { name: /^Game / })) expect(link).toHaveClass('aspect-[264/352]');
  });
  it('keeps the 2:3 covers of the anime widget', () => {
    render(<WallWidgetCard widget={anime} accent="#3366ff" />);
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toHaveClass('aspect-[2/3]');
  });
  it('while editing, draws the covers as editable places with the empty ones to fill', () => {
    const editor = { disabled: false, widgetName: 'Jogos que eu gosto', onAdd: vi.fn(), onReplace: vi.fn(), onRemove: vi.fn(), onMove: vi.fn() };
    render(<WallWidgetCard widget={gameWidget('igdb-liked-games', [game(1), game(2)])} accent="#3366ff" gameEditor={editor} />);
    // no link to leave the page by while editing
    expect(screen.queryByRole('link', { name: 'Game 1' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Adicionar jogo a Jogos que eu gosto' })).toHaveLength(6);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
  });
  it('reveals the controls of a cover on a tap, where there is no hover', async () => {
    const user = userEvent.setup();
    const editor = { disabled: false, widgetName: 'x', onAdd: vi.fn(), onReplace: vi.fn(), onRemove: vi.fn(), onMove: vi.fn() };
    render(<WallWidgetCard widget={gameWidget('igdb-liked-games', [game(1)])} accent="#3366ff" gameEditor={editor} />);
    const controls = screen.getByRole('button', { name: 'Trocar Game 1' }).parentElement!;
    expect(controls).toHaveAttribute('data-tapped', 'false');
    await user.click(controls.previousElementSibling!);
    expect(controls).toHaveAttribute('data-tapped', 'true');
    await user.click(screen.getByRole('button', { name: 'Remover Game 1' }));
    expect(editor.onRemove).toHaveBeenCalledWith(0);
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

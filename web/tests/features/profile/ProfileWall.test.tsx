import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ProfileWall } from '@/features/profile/ProfileWall';
import { WallWidgetCard } from '@/features/profile/WallWidgetCard';
import * as api from '@/features/profile/profileApi';
import type { ProfileConnection, WallResponse, WallWidget } from '@/features/profile/connectionsTypes';

vi.mock('@/features/profile/profileApi', () => ({ fetchWall: vi.fn(), saveWall: vi.fn() }));
const mocked = vi.mocked(api);
const connection: ProfileConnection = { id: 'mal', provider: 'myanimelist', value: 'Xinil', url: 'https://myanimelist.net/profile/Xinil', position: 0, syncedAt: '2026-11-05T12:00:00Z', syncError: null, status: 'ready' };
const anime: WallWidget = { connection, type: 'mal-recent-anime', data: { kind: 'list', items: [{ id: '1', title: 'Cowboy Bebop', url: 'https://myanimelist.net/anime/1', imageUrl: null }] } };
const profile: WallWidget = { connection: { ...connection, id: 'gh', provider: 'github', value: 'octocat', url: 'https://github.com/octocat' }, type: 'github-profile', data: { kind: 'github-profile', login: 'octocat', name: null, avatarUrl: null, repositories: 1, followers: 2, following: 3 } };
const empty: WallResponse = { widgets: [], available: [anime, profile] };
beforeEach(() => { vi.clearAllMocks(); mocked.fetchWall.mockResolvedValue(empty); });
function renderWall(owner = true) { render(<MemoryRouter><ProfileWall userId="me" owner={owner} onNavigate={vi.fn()} /></MemoryRouter>); }

describe('profile Wall', () => {
  it('starts empty and keeps available data unpublished until explicitly saved', async () => {
    const user = userEvent.setup(); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Editar Mural' }));
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
    await user.click(await screen.findByRole('button', { name: 'Editar Mural' }));
    await user.click(screen.getByRole('button', { name: 'Atividade recente de animes' }));
    await user.click(screen.getByRole('button', { name: 'Perfil do GitHub' }));
    expect(screen.getByRole('button', { name: 'Mover Atividade recente de animes para cima' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Mover Perfil do GitHub para cima' }));
    const references = [{ connectionId: 'gh', type: 'github-profile' }, { connectionId: 'mal', type: 'mal-recent-anime' }];
    mocked.saveWall.mockResolvedValue({ ...empty, widgets: [profile, anime] });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalledWith(references));
    await user.click(await screen.findByRole('button', { name: 'Editar Mural' }));
    await user.click(screen.getByRole('button', { name: 'Remover Atividade recente de animes' }));
    expect(screen.queryByRole('link', { name: 'Cowboy Bebop' })).not.toBeInTheDocument();
  });
  it('shows published widgets to visitors without edit controls or the catalog', async () => {
    mocked.fetchWall.mockResolvedValue({ widgets: [anime] }); renderWall(false);
    expect(await screen.findByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Mural' })).not.toBeInTheDocument();
    expect(screen.queryByText('Adicionar widget')).not.toBeInTheDocument();
    expect(mocked.fetchWall).toHaveBeenCalledWith('me', false, expect.any(AbortSignal));
  });
  it('preserves the editable draft when saving fails', async () => {
    const user = userEvent.setup(); mocked.saveWall.mockRejectedValue(new Error('offline')); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Editar Mural' }));
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
    const { rerender } = render(<WallWidgetCard widget={{ ...anime, data: null, connection: { ...connection, syncedAt: null } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Os dados aparecerão após a primeira sincronização.');
    rerender(<WallWidgetCard widget={{ ...anime, data: null, connection: { ...connection, syncError: 'private' } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Não foi possível carregar os dados deste widget.');
    rerender(<WallWidgetCard widget={{ ...anime, connection: { ...connection, syncError: 'unavailable' } }} />);
    expect(screen.getByRole('link', { name: 'Cowboy Bebop' })).toBeInTheDocument();
    expect(screen.getByText(/A última sincronização falhou/)).toBeInTheDocument();
  });
  it('shows only the covers of the first eight recent anime, without titles or progress', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: `Anime ${i}`, url: `https://myanimelist.net/anime/${i}`, imageUrl: `https://cdn.myanimelist.net/${i}.jpg` }));
    render(<WallWidgetCard widget={{ ...anime, data: { kind: 'list', items } }} />);
    expect(screen.getAllByRole('link', { name: /^Anime / })).toHaveLength(8);
    expect(screen.queryByRole('link', { name: 'Anime 8' })).not.toBeInTheDocument();
    expect(screen.queryByText('Anime 0')).not.toBeInTheDocument();
  });
  it('renders a contribution calendar with localized day descriptions', () => {
    render(<WallWidgetCard widget={{ connection: { ...connection, provider: 'github' }, type: 'github-calendar', data: { kind: 'github-calendar', total: 4, days: [{ date: '2026-11-01', count: 4, level: 3 }] } }} />);
    expect(screen.getByRole('group', { name: 'Calendário de contribuições do GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /4 contribuições/ })).toBeInTheDocument();
    expect(screen.getByText('4 contribuições nos últimos 12 meses')).toBeInTheDocument();
  });
  it('keeps only the most recent weeks that fit the calendar width', () => {
    const days = Array.from({ length: 70 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 4 + i)).toISOString().slice(0, 10), count: i, level: 1 }));
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 36 } as DOMRect);
    // 3 weeks fit: 3 * 10px cells + 2 * 3px gaps
    try {
      render(<WallWidgetCard widget={{ connection: { ...connection, provider: 'github' }, type: 'github-calendar', data: { kind: 'github-calendar', total: 4, days } }} />);
      const cells = screen.getAllByRole('img');
      expect(cells).toHaveLength(21);
      expect(cells[0]).toHaveAccessibleName(/49 contribuições/);
      expect(cells.at(-1)).toHaveAccessibleName(/69 contribuições/);
    } finally {
      rect.mockRestore();
    }
  });
});

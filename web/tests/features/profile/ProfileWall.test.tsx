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
const anime: WallWidget = { connection, type: 'mal-favorite-anime', data: { kind: 'list', items: [{ id: '1', title: 'Cowboy Bebop', url: 'https://myanimelist.net/anime/1', imageUrl: null, status: null, progress: null, total: null }] } };
const manga: WallWidget = { connection, type: 'mal-favorite-manga', data: { kind: 'list', items: [] } };
const empty: WallResponse = { widgets: [], available: [anime, manga] };
beforeEach(() => { vi.clearAllMocks(); mocked.fetchWall.mockResolvedValue(empty); });
function renderWall(owner = true) { render(<MemoryRouter><ProfileWall userId="me" owner={owner} onNavigate={vi.fn()} /></MemoryRouter>); }

describe('profile Wall', () => {
  it('starts empty and keeps available data unpublished until explicitly saved', async () => {
    const user = userEvent.setup(); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Editar Mural' }));
    expect(screen.queryByText('Cowboy Bebop')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Animes favoritos' }));
    expect(screen.getByText('Cowboy Bebop')).toBeInTheDocument();
    expect(mocked.saveWall).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText('Cowboy Bebop')).not.toBeInTheDocument();
    expect(mocked.saveWall).not.toHaveBeenCalled();
  });
  it('adds, reorders and saves only connection references, then supports removing widgets', async () => {
    const user = userEvent.setup(); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Editar Mural' }));
    await user.click(screen.getByRole('button', { name: 'Animes favoritos' }));
    await user.click(screen.getByRole('button', { name: 'Mangás favoritos' }));
    expect(screen.getByRole('button', { name: 'Mover Animes favoritos para cima' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Mover Mangás favoritos para cima' }));
    const references = [{ connectionId: 'mal', type: 'mal-favorite-manga' }, { connectionId: 'mal', type: 'mal-favorite-anime' }];
    mocked.saveWall.mockResolvedValue({ ...empty, widgets: [manga, anime] });
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.saveWall).toHaveBeenCalledWith(references));
    await user.click(await screen.findByRole('button', { name: 'Editar Mural' }));
    await user.click(screen.getByRole('button', { name: 'Remover Animes favoritos' }));
    expect(screen.queryByText('Cowboy Bebop')).not.toBeInTheDocument();
  });
  it('shows published widgets to visitors without edit controls or the catalog', async () => {
    mocked.fetchWall.mockResolvedValue({ widgets: [anime] }); renderWall(false);
    expect(await screen.findByText('Cowboy Bebop')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Mural' })).not.toBeInTheDocument();
    expect(screen.queryByText('Adicionar widget')).not.toBeInTheDocument();
    expect(mocked.fetchWall).toHaveBeenCalledWith('me', false, expect.any(AbortSignal));
  });
  it('preserves the editable draft when saving fails', async () => {
    const user = userEvent.setup(); mocked.saveWall.mockRejectedValue(new Error('offline')); renderWall();
    await user.click(await screen.findByRole('button', { name: 'Editar Mural' }));
    await user.click(screen.getByRole('button', { name: 'Animes favoritos' }));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar o Mural.');
    expect(screen.getByText('Cowboy Bebop')).toBeInTheDocument();
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
    expect(screen.getByText('Cowboy Bebop')).toBeInTheDocument();
    expect(screen.getByText(/A última sincronização falhou/)).toBeInTheDocument();
  });
  it('renders a scrollable contribution calendar with localized day descriptions', () => {
    render(<WallWidgetCard widget={{ connection: { ...connection, provider: 'github' }, type: 'github-calendar', data: { kind: 'github-calendar', total: 4, days: [{ date: '2026-11-01', count: 4, level: 3 }] } }} />);
    expect(screen.getByRole('region', { name: 'Calendário de contribuições do GitHub' })).toHaveClass('overflow-x-auto');
    expect(screen.getByRole('img', { name: /4 contribuições/ })).toBeInTheDocument();
    expect(screen.getByText('4 contribuições nos últimos 12 meses')).toBeInTheDocument();
  });
});

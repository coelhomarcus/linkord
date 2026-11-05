import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionsSettings } from '@/features/profile/ConnectionsSettings';
import * as api from '@/features/profile/profileApi';
import { ApiError } from '@/shared/api/api';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { ConnectionsResponse, ProfileConnection } from '@/features/profile/connectionsTypes';

vi.mock('@/features/profile/profileApi', () => ({ fetchConnections: vi.fn(), createConnection: vi.fn(), editConnection: vi.fn(), deleteConnection: vi.fn() }));
const mocked = vi.mocked(api);
const connection: ProfileConnection = { id: 'mal', provider: 'myanimelist', value: 'Xinil', url: 'https://myanimelist.net/profile/Xinil', position: 0, syncedAt: null, syncError: null, status: 'pending' };
const empty: ConnectionsResponse = { connections: [] };
beforeEach(() => { vi.clearAllMocks(); mocked.fetchConnections.mockResolvedValue(empty); });
function renderSettings() {
  const dispatch = vi.fn();
  renderWithRoom(<ConnectionsSettings />, { dispatch, state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } } });
  return { dispatch };
}

describe('connection settings', () => {
  it('connects MyAnimeList with only a username and publishes the confirmed link to local state', async () => {
    const user = userEvent.setup(); const { dispatch } = renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: 'MyAnimeList' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'MyAnimeList' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/não verifica a titularidade/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText('Nome de usuário'), 'Xinil');
    const result = { ...empty, connections: [connection] };
    mocked.createConnection.mockResolvedValue(result); mocked.fetchConnections.mockResolvedValue(result);
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocked.createConnection).toHaveBeenCalledWith('myanimelist', 'Xinil');
    expect(dispatch).toHaveBeenCalledWith({ type: 'PROFILE_CONNECTIONS_CHANGED', userId: 'me', profileLinks: [connection.url] });
    expect(screen.getByText('Aguardando a primeira sincronização…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MyAnimeList' })).toBeDisabled();
  });
  it('opens URL and GitHub dialogs with the appropriate input', async () => {
    const user = userEvent.setup(); renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: 'URL' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'URL' }));
    expect(screen.getByLabelText('URL')).toHaveAttribute('type', 'url');
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await user.click(screen.getByRole('button', { name: 'GitHub' }));
    expect(screen.getByLabelText('Nome de usuário')).toHaveAttribute('maxlength', '39');
  });
  it('enforces the count limit while preserving existing connections', async () => {
    mocked.fetchConnections.mockResolvedValue({ connections: Array.from({ length: 8 }, (_, index) => ({ ...connection, id: String(index), provider: 'url', value: `https://example.com/${index}`, url: `https://example.com/${index}`, status: 'ready' })) });
    renderSettings();
    await waitFor(() => expect(screen.getAllByRole('link')).toHaveLength(8));
    for (const name of ['URL', 'MyAnimeList', 'GitHub']) expect(screen.getByRole('button', { name })).toBeDisabled();
    expect(screen.getAllByRole('link')).toHaveLength(8);
  });
  it('edits a username and confirms deletion with its widget cleanup explanation', async () => {
    const user = userEvent.setup(); const result = { ...empty, connections: [connection] };
    mocked.fetchConnections.mockResolvedValue(result); renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Editar conexão Xinil' }));
    const input = screen.getByLabelText('Nome de usuário'); await user.clear(input); await user.type(input, 'otheruser');
    mocked.editConnection.mockResolvedValue(result);
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(mocked.editConnection).toHaveBeenCalledWith('mal', 'otheruser'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Remover conexão Xinil' }));
    expect(screen.getByText(/widgets desta conexão/)).toBeInTheDocument();
    mocked.deleteConnection.mockResolvedValue(empty); mocked.fetchConnections.mockResolvedValue(empty);
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocked.deleteConnection).toHaveBeenCalledWith('mal'));
  });
  it('keeps the modal editable after a refused save and supports keyboard submission', async () => {
    const user = userEvent.setup(); renderSettings();
    await waitFor(() => expect(screen.getByRole('button', { name: 'MyAnimeList' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'MyAnimeList' }));
    mocked.createConnection.mockRejectedValue(new ApiError(400, 'invalid_connection', 'invalid'));
    await user.type(screen.getByLabelText('Nome de usuário'), '../bad{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe uma URL http/https válida ou um nome de usuário válido para o serviço.');
    expect(screen.getByLabelText('Nome de usuário')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { ProfileActions } from '@/features/friends/ProfileActions';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRelationship: vi.fn(), fetchRequestSummary: vi.fn(), sendFriendRequest: vi.fn(), acceptFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(), cancelFriendRequest: vi.fn(), unblockUser: vi.fn(),
}));
const mocked = vi.mocked(api);

function renderActions(relation: api.Relation, retryAfter: string | null = null, onNavigate = vi.fn()) {
  mocked.fetchRelationship.mockResolvedValue({ relation, retryAfter });
  return renderSocial(<ProfileActions userId="u-ana" username="ana" displayName="Ana" onNavigate={onNavigate} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
});

describe('ProfileActions — what shows up only depends on the relationship', () => {
  it('no relationship: Adicionar amigo sends the request by username', async () => {
    const user = userEvent.setup();
    mocked.sendFriendRequest.mockResolvedValue('created');
    renderActions('none');

    await user.click(await screen.findByRole('button', { name: 'Adicionar amigo' }));
    expect(mocked.sendFriendRequest).toHaveBeenCalledWith('ana');
  });

  it('no relationship but in cooldown: does not offer the button, says when it comes back', async () => {
    renderActions('none', '2099-01-01T12:00:00.000Z');
    expect(await screen.findByText(/poderá enviar uma nova solicitação a partir de/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar amigo' })).not.toBeInTheDocument();
  });

  it('request sent: shows the state and allows canceling', async () => {
    const user = userEvent.setup();
    mocked.cancelFriendRequest.mockResolvedValue({});
    renderActions('outgoing');

    expect(await screen.findByText('Solicitação enviada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(mocked.cancelFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('request received: Aceitar and Recusar', async () => {
    const user = userEvent.setup();
    mocked.acceptFriendRequest.mockResolvedValue({});
    mocked.declineFriendRequest.mockResolvedValue({});
    renderActions('incoming');

    await user.click(await screen.findByRole('button', { name: 'Aceitar' }));
    expect(mocked.acceptFriendRequest).toHaveBeenCalledWith('u-ana');
    await user.click(screen.getByRole('button', { name: 'Recusar' }));
    expect(mocked.declineFriendRequest).toHaveBeenCalledWith('u-ana');
  });

  it('friends: Mensagem (closes the modal), a friendship menu with Remover and a "more" menu with Bloquear', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    renderActions('friends', null, onNavigate);

    await user.click(await screen.findByRole('button', { name: 'Mensagem' }));
    expect(onNavigate).toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Amizade' }));
    expect(await screen.findByRole('menuitem', { name: 'Remover amizade' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Mais ações' }));
    expect(await screen.findByRole('menuitem', { name: 'Bloquear' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Denunciar' })).not.toBeInTheDocument();
  });

  it('Denunciar sits in the "more" menu when the parent can report, for friends and strangers alike', async () => {
    const user = userEvent.setup();
    const onReport = vi.fn();
    mocked.fetchRelationship.mockResolvedValue({ relation: 'none', retryAfter: null });
    renderSocial(<ProfileActions userId="u-ana" username="ana" displayName="Ana" onReport={onReport} />);

    await user.click(await screen.findByRole('button', { name: 'Mais ações' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Denunciar' }));
    expect(onReport).toHaveBeenCalled();
  });

  it('your own profile has no "more" menu to report yourself', async () => {
    mocked.fetchRelationship.mockResolvedValue({ relation: 'self', retryAfter: null });
    renderSocial(<ProfileActions userId="me" username="eu" displayName="Eu" onReport={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Editar perfil' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mais ações' })).not.toBeInTheDocument();
  });

  it('blocked by me: only Desbloquear', async () => {
    const user = userEvent.setup();
    mocked.unblockUser.mockResolvedValue({});
    renderActions('blocked');

    expect(await screen.findByText('Você bloqueou essa pessoa')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desbloquear' }));
    expect(mocked.unblockUser).toHaveBeenCalledWith('u-ana');
  });

  it('own profile: Editar perfil, no social action', async () => {
    renderActions('self');
    expect(await screen.findByRole('button', { name: 'Editar perfil' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar amigo' })).not.toBeInTheDocument();
  });

  it('failure loading the relationship: error with retry, never silently closes', async () => {
    const user = userEvent.setup();
    mocked.fetchRelationship.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ relation: 'none', retryAfter: null });
    renderSocial(<ProfileActions userId="u-ana" username="ana" displayName="Ana" />);

    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByRole('button', { name: 'Adicionar amigo' })).toBeInTheDocument();
  });

  it('a send error uses the generic message', async () => {
    const user = userEvent.setup();
    mocked.sendFriendRequest.mockRejectedValue(new api.ApiError(404, 'user_unavailable', 'x'));
    renderActions('none');

    await user.click(await screen.findByRole('button', { name: 'Adicionar amigo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Confira o nome de usuário/);
  });
});

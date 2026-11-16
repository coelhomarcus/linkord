import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { ProfileActions } from '@/features/friends/ProfileActions';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRelationship: vi.fn(), fetchRequestSummary: vi.fn(), sendFriendRequest: vi.fn(), acceptFriendRequest: vi.fn(),
  declineFriendRequest: vi.fn(), cancelFriendRequest: vi.fn(), unblockUser: vi.fn(), removeFriend: vi.fn(),
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
    renderSocial(<ProfileActions userId="me" username="eu" displayName="Eu" onReport={vi.fn()} onEditProfile={vi.fn()} />);
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

  it('own profile: Editar perfil opens your full profile, no social action', async () => {
    const onEditProfile = vi.fn();
    mocked.fetchRelationship.mockResolvedValue({ relation: 'self', retryAfter: null });
    renderSocial(<ProfileActions userId="me" username="eu" displayName="Eu" onEditProfile={onEditProfile} />);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Editar perfil' }));
    expect(onEditProfile).toHaveBeenCalled();
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

describe('ProfileActions — optimistic', () => {
  function never<T>(): Promise<T> { return new Promise<T>(() => {}); }

  it('a friend from the live friends list gets the friend actions before the relationship is read', () => {
    mocked.fetchRelationship.mockReturnValue(never());
    renderSocial(<ProfileActions userId="u-ana" username="ana" displayName="Ana" />, { room: { friendUserIds: new Set(['u-ana']) } });
    expect(screen.getByRole('button', { name: 'Mensagem' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('someone never seen holds the place of the buttons, and says it is loading', () => {
    mocked.fetchRelationship.mockReturnValue(never());
    renderSocial(<ProfileActions userId="u-ana" username="ana" displayName="Ana" />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a relationship read once opens at once on the next profile, and is read again behind it', async () => {
    mocked.fetchRelationship.mockResolvedValue({ relation: 'outgoing', retryAfter: null });
    const first = renderSocial(<ProfileActions userId="u-ana" username="ana" displayName="Ana" />);
    expect(await screen.findByText('Solicitação enviada')).toBeInTheDocument();
    first.unmount();

    mocked.fetchRelationship.mockReturnValue(never());
    renderSocial(<ProfileActions userId="u-ana" username="ana" displayName="Ana" />);
    expect(screen.getByText('Solicitação enviada')).toBeInTheDocument();
    expect(mocked.fetchRelationship).toHaveBeenCalledTimes(2);
  });

  it('Adicionar amigo turns into "Solicitação enviada" before the server answers', async () => {
    const user = userEvent.setup();
    mocked.sendFriendRequest.mockReturnValue(never());
    renderActions('none');

    await user.click(await screen.findByRole('button', { name: 'Adicionar amigo' }));
    expect(screen.getByText('Solicitação enviada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeEnabled();
  });

  it('a refused request puts Adicionar amigo back and says why', async () => {
    const user = userEvent.setup();
    let refuse!: (error: unknown) => void;
    mocked.sendFriendRequest.mockReturnValue(new Promise((_, reject) => { refuse = reject; }));
    renderActions('none');

    await user.click(await screen.findByRole('button', { name: 'Adicionar amigo' }));
    expect(screen.getByText('Solicitação enviada')).toBeInTheDocument();
    refuse(new api.ApiError(404, 'user_unavailable', 'x'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Confira o nome de usuário/);
    expect(await screen.findByRole('button', { name: 'Adicionar amigo' })).toBeInTheDocument();
  });

  it('Aceitar makes them a friend at once, and a refusal brings the request back', async () => {
    const user = userEvent.setup();
    let refuse!: (error: unknown) => void;
    mocked.acceptFriendRequest.mockReturnValue(new Promise((_, reject) => { refuse = reject; }));
    renderActions('incoming');

    await user.click(await screen.findByRole('button', { name: 'Aceitar' }));
    expect(screen.getByRole('button', { name: 'Mensagem' })).toBeInTheDocument();
    refuse(new Error('offline'));
    expect(await screen.findByRole('button', { name: 'Aceitar' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('a request sent while the other side had already asked lands as a request received', async () => {
    const user = userEvent.setup();
    mocked.sendFriendRequest.mockResolvedValue('pending_received');
    renderActions('none');
    mocked.fetchRelationship.mockReturnValue(never());

    await user.click(await screen.findByRole('button', { name: 'Adicionar amigo' }));
    expect(await screen.findByRole('button', { name: 'Aceitar' })).toBeInTheDocument();
  });

  it('a change clicked while the previous one is on its way waits for it, in order', async () => {
    const user = userEvent.setup();
    let accept!: (value: unknown) => void;
    mocked.sendFriendRequest.mockReturnValue(new Promise((resolve) => { accept = () => resolve('created'); }));
    mocked.cancelFriendRequest.mockResolvedValue({});
    renderActions('none');

    await user.click(await screen.findByRole('button', { name: 'Adicionar amigo' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.getByRole('button', { name: 'Adicionar amigo' })).toBeInTheDocument();
    expect(mocked.cancelFriendRequest).not.toHaveBeenCalled();
    accept(undefined);
    await waitFor(() => expect(mocked.cancelFriendRequest).toHaveBeenCalledWith('u-ana'));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { InviteCard } from '@/features/chat/InviteCard';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';
import * as api from '@/shared/api/api';
import type { InvitationCard, ServerSummary } from '@/shared/types/protocol';
import { MemoryRouter } from 'react-router';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  acceptInvitation: vi.fn(), declineInvitation: vi.fn(), revokeInvitation: vi.fn(),
}));
const mocked = vi.mocked(api);

const card = (over: Partial<InvitationCard> = {}): InvitationCard => ({
  id: 'inv-1', status: 'pending', serverId: 'g1', serverName: 'Squad', serverIcon: '', memberCount: 3,
  inviterId: 'owner', inviteeId: 'me', version: 1, ...over,
});
const group = (): ServerSummary => ({
  id: 'g1', name: 'Squad', icon: '', ownerId: 'owner', status: 'active', createdAt: 1, memberCount: 3, position: 0,
  permissions: 0, myRoleIds: [], roles: [], categories: [], channels: [],
});
const asUser = (userId: string, servers: ServerSummary[] = []) => renderWithRoom(<MemoryRouter><Slot /></MemoryRouter>, {
  state: { ...initialRoomState, me: { ...initialRoomState.me, userId } }, servers,
});
let current: InvitationCard | null | undefined;
function Slot() { return <InviteCard invitation={current} />; }
const render = (invitation: InvitationCard | null, userId = 'me', servers: ServerSummary[] = []) => {
  current = invitation;
  return asUser(userId, servers);
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe('InviteCard', () => {
  it('recipient sees Join/Decline on a pending invitation', async () => {
    const user = userEvent.setup();
    mocked.acceptInvitation.mockResolvedValue({ invitation: card({ status: 'accepted' }) });
    render(card());
    expect(screen.getByText('Squad')).toBeInTheDocument();
    expect(screen.getByText(/verá o histórico/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar no servidor' }));
    expect(mocked.acceptInvitation).toHaveBeenCalledWith('inv-1');
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeInTheDocument();
  });

  it('declining calls the decline endpoint', async () => {
    const user = userEvent.setup();
    mocked.declineInvitation.mockResolvedValue({ invitation: card({ status: 'declined' }) });
    render(card());
    await user.click(screen.getByRole('button', { name: 'Recusar' }));
    expect(mocked.declineInvitation).toHaveBeenCalledWith('inv-1');
  });

  it('server_full error shows "Limite atingido" without offering Join', async () => {
    const user = userEvent.setup();
    mocked.acceptInvitation.mockRejectedValue(new api.ApiError(409, 'server_full', 'cheio'));
    render(card());
    await user.click(screen.getByRole('button', { name: 'Entrar no servidor' }));
    expect(await screen.findByText(/Limite atingido/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar no servidor' })).not.toBeInTheDocument();
  });

  it('the inviter sees "Aguardando" and may take it back', async () => {
    const user = userEvent.setup();
    mocked.revokeInvitation.mockResolvedValue({ invitation: card({ status: 'revoked' }) });
    render(card(), 'owner', [group()]);
    expect(screen.getByText(/Aguardando resposta/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Revogar' }));
    expect(mocked.revokeInvitation).toHaveBeenCalledWith('inv-1');
  });

  it('accepted: "Abrir servidor" only shows up while still a member', () => {
    const { unmount } = render(card({ status: 'accepted' }), 'me', [group()]);
    expect(screen.getByRole('button', { name: 'Abrir servidor' })).toBeInTheDocument();
    unmount();

    render(card({ status: 'accepted' }), 'me', []);
    expect(screen.queryByRole('button', { name: 'Abrir servidor' })).not.toBeInTheDocument();
    expect(screen.getByText('Aceito')).toBeInTheDocument();
  });

  it.each([['declined', 'Recusado'], ['revoked', 'Cancelado'], ['expired', 'Expirado']] as const)('terminal state %s', (status, label) => {
    render(card({ status }));
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar no servidor' })).not.toBeInTheDocument();
  });

  it('pending but already a member: "Você já participa"', () => {
    render(card(), 'me', [group()]);
    expect(screen.getByText(/já participa/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Entrar no servidor' })).not.toBeInTheDocument();
  });

  it('pending shows no deadline: a named invitation never expires', () => {
    render(card());
    expect(screen.getByText('Entrar no servidor')).toBeInTheDocument();
    expect(screen.queryByText(/vence/)).not.toBeInTheDocument();
  });

  it('tombstone when the server has been deleted', () => {
    render(null);
    expect(screen.getByText(/Convite indisponível/)).toBeInTheDocument();
  });

  it('generic error shows an alert and keeps the buttons', async () => {
    const user = userEvent.setup();
    mocked.acceptInvitation.mockRejectedValue(new Error('boom'));
    render(card());
    await user.click(screen.getByRole('button', { name: 'Entrar no servidor' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Entrar no servidor' })).toBeEnabled();
  });
});

describe('InviteCard in English', () => {
  useLanguageForTests('en-US');

  it('words the invitation and its actions in English', () => {
    render(card());
    expect(screen.getByText('Server invitation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join the server' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(screen.getByText('3 members')).toBeInTheDocument();
  });
});

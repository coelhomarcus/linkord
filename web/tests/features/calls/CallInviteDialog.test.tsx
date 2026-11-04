import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CallInviteDialog } from '@/features/calls/CallInviteDialog';
import * as api from '@/shared/api/api';
import * as serversApi from '@/features/servers/serversApi';
import type { Conversation, Participant, PublicUser } from '@/shared/types/protocol';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  inviteToCall: vi.fn(),
}));
vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  fetchAllServerMembers: vi.fn(),
}));
const mocked = vi.mocked(api);
const mockedServers = vi.mocked(serversApi);

const user = (id: string, displayName: string): PublicUser => ({
  id, username: id, displayName, avatar: '', avatarColor: '', banner: '', bio: '', profileLinks: [], role: 'user',
});
const channel: Conversation = {
  id: 'g1', type: 'voice', title: 'Squad', serverId: 's1', memberIds: [],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null,
};
const users = new Map([user('me', 'Eu'), user('ana', 'Ana'), user('bia', 'Bia'), user('caio', 'Caio'), user('duda', 'Duda')].map((u) => [u.id, u]));
const duda = { id: 'conn-duda', userId: 'duda', callConversationId: 'g1' } as Participant;

function render() {
  return renderWithRoom(<CallInviteDialog open onOpenChange={() => {}} conversationId="g1" />, {
    state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' }, participants: new Map([[duda.id, duda]]) },
    conversations: [channel],
    allUsers: users,
    friendUserIds: new Set(['ana', 'bia', 'duda']),
  });
}

const row = (name: string) => screen.getByText(name).closest('li')!;

beforeEach(() => {
  vi.clearAllMocks();
  mockedServers.fetchAllServerMembers.mockResolvedValue([...users.values()].map((u) => ({ user: u, roleIds: [], isOwner: false, at: '' })));
});

describe('CallInviteDialog', () => {
  it('lists the server members who are not in the call, never yourself', async () => {
    render();
    expect(screen.getByText('Convidar para Squad')).toBeInTheDocument();
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bia')).toBeInTheDocument();
    expect(screen.getByText('Caio')).toBeInTheDocument();
    expect(screen.queryByText('Duda')).not.toBeInTheDocument();
    expect(screen.queryByText('Eu')).not.toBeInTheDocument();
  });

  it('sends an invite per person and marks it sent', async () => {
    const u = userEvent.setup();
    mocked.inviteToCall.mockResolvedValue({ ok: true });
    render();
    await screen.findByText('Ana');
    await u.click(within(row('Ana')).getByRole('button', { name: 'Convidar' }));
    expect(mocked.inviteToCall).toHaveBeenCalledWith('g1', 'ana');
    expect(within(row('Ana')).getByRole('button', { name: 'Enviado' })).toBeDisabled();
    expect(within(row('Bia')).getByRole('button', { name: 'Convidar' })).toBeEnabled();
  });

  it('a member who is not your friend cannot be invited', async () => {
    render();
    await screen.findByText('Caio');
    expect(within(row('Caio')).getByText('Só amigos recebem convite')).toBeInTheDocument();
    expect(within(row('Caio')).getByRole('button', { name: 'Convidar' })).toBeDisabled();
  });

  it("says why the server refused", async () => {
    const u = userEvent.setup();
    mocked.inviteToCall.mockRejectedValue(new api.ApiError(409, 'conflict', 'x'));
    render();
    await screen.findByText('Bia');
    await u.click(within(row('Bia')).getByRole('button', { name: 'Convidar' }));
    expect(within(row('Bia')).getByRole('alert')).toHaveTextContent('Já está na chamada.');
  });

  it('filters by name', async () => {
    const u = userEvent.setup();
    render();
    await screen.findByText('Bia');
    await u.type(screen.getByRole('textbox', { name: 'Buscar membros' }), 'bi');
    expect(screen.getByText('Bia')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });
});

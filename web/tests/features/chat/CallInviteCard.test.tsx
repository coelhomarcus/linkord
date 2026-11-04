import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CallInviteCard } from '@/features/chat/CallInviteCard';
import type { CallInviteCard as CallInvite, Conversation, Participant } from '@/shared/types/protocol';

const invite: CallInvite = { channelId: 'g1', channelName: 'Squad', serverId: 's1', serverName: 'Servidor', serverIcon: '' };
const channel: Conversation = {
  id: 'g1', type: 'voice', title: 'Squad', serverId: 's1', memberIds: ['me', 'ana'],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null,
};
const ana = { id: 'conn-ana', userId: 'ana', displayName: 'Ana', avatar: '', avatarPoster: '', avatarColor: '', callConversationId: 'g1' } as Participant;

function render(callInvite: CallInvite | null, opts: { inCall?: Participant[]; conversations?: Conversation[]; active?: string | null } = {}) {
  const openCall = vi.fn();
  renderWithRoom(<CallInviteCard callInvite={callInvite} />, {
    state: {
      ...initialRoomState,
      me: { ...initialRoomState.me, userId: 'me', displayName: 'Eu' },
      participants: new Map((opts.inCall ?? []).map((p) => [p.id, p])),
    },
    conversations: opts.conversations ?? [channel],
    activeCallConversationId: opts.active ?? null,
    openCall,
  });
  return openCall;
}

describe('CallInviteCard', () => {
  it('names the channel and who is in its call, and joins it', async () => {
    const user = userEvent.setup();
    const openCall = render(invite, { inCall: [ana] });
    expect(screen.getByText('Squad')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entrar na chamada de voz' }));
    expect(openCall).toHaveBeenCalledWith('g1');
  });

  it('counts everyone once more than one person is there', () => {
    render(invite, { inCall: [ana, { ...ana, id: 'conn-bia', userId: 'bia', displayName: 'Bia' }] });
    expect(screen.getByText('2 pessoas na chamada')).toBeInTheDocument();
  });

  it('offers the way back when you are already in that call', () => {
    render(invite, { inCall: [ana], active: 'g1' });
    expect(screen.getByText('2 pessoas na chamada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para a chamada' })).toBeInTheDocument();
  });

  it('an empty call reads as ended, with nothing to join', () => {
    render(invite);
    expect(screen.getByText('A chamada terminou')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('someone who can no longer see the channel gets no way in', () => {
    render(invite, { inCall: [ana], conversations: [] });
    expect(screen.getByText('Você não faz mais parte desse canal.')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('a deleted channel leaves a tombstone', () => {
    render(null);
    expect(screen.getByText('Convite para chamada indisponível')).toBeInTheDocument();
  });
});

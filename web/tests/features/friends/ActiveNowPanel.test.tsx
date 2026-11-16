import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ActiveNowPanel } from '@/features/friends/ActiveNowPanel';
import type { Conversation, Participant, ServerSummary } from '@/shared/types/protocol';

const voice: Conversation = { id: 'voz', type: 'voice', title: 'Geral', serverId: 's1', memberIds: [], lastMessageAt: null, createdAt: 0, updatedAt: 0 };
const server = { id: 's1', name: 'Squad', icon: '', channels: [], categories: [], roles: [] } as unknown as ServerSummary;
const inCall = (userId: string, name: string, callConversationId: string | null = 'voz') =>
  ({ id: `p-${userId}`, userId, displayName: name, avatar: '', avatarPoster: '', avatarColor: '', callConversationId }) as Participant;

function renderPanel(participants: Participant[], friends: string[], openCall = vi.fn(), activeCallConversationId: string | null = null) {
  const { container } = renderWithRoom(<ActiveNowPanel />, {
    state: {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'p-me', userId: 'me', displayName: 'Eu' },
      participants: new Map(participants.map((p) => [p.id, p])),
    },
    conversations: [voice], servers: [server], friendUserIds: new Set(friends), openCall, activeCallConversationId,
  });
  return Object.assign(openCall, { container });
}

describe('ActiveNowPanel', () => {
  it('shows the calls friends are in, with where they are, and joins on click', async () => {
    const openCall = renderPanel([inCall('ana', 'Ana'), inCall('bia', 'Bia'), inCall('stranger', 'Estranho')], ['ana', 'bia']);
    expect(screen.getByText('Ana e mais 1')).toBeInTheDocument();
    expect(screen.getByText('Geral · Squad')).toBeInTheDocument();
    expect(screen.queryByText(/Estranho/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Ana e mais 1/ }));
    expect(openCall).toHaveBeenCalledWith('voz');
  });

  it('says it is quiet when no friend is in a call you can see', () => {
    renderPanel([inCall('ana', 'Ana', null), inCall('bia', 'Bia', 'somewhere-else')], ['ana', 'bia']);
    expect(screen.getByText('Está tranquilo por enquanto…')).toBeInTheDocument();
  });

  it('puts everyone in the call in its avatars, you included when you are in it', () => {
    const { container } = renderPanel([inCall('ana', 'Ana'), inCall('stranger', 'Zé Ninguém')], ['ana'], vi.fn(), 'voz');
    // the lead's avatar, then the call's group: Ana, the stranger and you
    const group = container.querySelector('.-space-x-1\\.5');
    expect(group?.textContent).toBe('AZNE');
  });
});

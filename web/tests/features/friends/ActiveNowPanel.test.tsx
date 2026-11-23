import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ActiveNowPanel } from '@/features/friends/ActiveNowPanel';
import type { Activity, Conversation, Participant, PublicUser, ServerSummary } from '@/shared/types/protocol';

const voice: Conversation = { id: 'voz', type: 'voice', title: 'Geral', serverId: 's1', memberIds: [], lastMessageAt: null, createdAt: 0, updatedAt: 0 };
const server = { id: 's1', name: 'Squad', icon: '', channels: [], categories: [], roles: [] } as unknown as ServerSummary;
const inCall = (userId: string, name: string, callConversationId: string | null = 'voz') =>
  ({ id: `p-${userId}`, userId, displayName: name, avatar: '', avatarPoster: '', avatarColor: '', callConversationId }) as Participant;

function renderPanel(participants: Participant[], friends: string[], openCall = vi.fn(), activeCallConversationId: string | null = null, onOpenProfile = vi.fn()) {
  const { container } = renderWithRoom(<ActiveNowPanel onOpenProfile={onOpenProfile} />, {
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
    expect(screen.getByText('Squad')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Chamada de voz em Geral' })).toBeInTheDocument();
    expect(screen.queryByText(/Estranho/)).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar' }));
    expect(openCall).toHaveBeenCalledWith('voz');
  });

  it('says it is quiet when no friend is in a call you can see', () => {
    renderPanel([inCall('ana', 'Ana', null), inCall('bia', 'Bia', 'somewhere-else')], ['ana', 'bia']);
    expect(screen.getByText('Está tranquilo por enquanto…')).toBeInTheDocument();
  });

  it('puts everyone in the call in its avatars, you included when you are in it', () => {
    const { container } = renderPanel([inCall('ana', 'Ana'), inCall('stranger', 'Zé Ninguém')], ['ana'], vi.fn(), 'voz');
    expect(container.querySelector('[data-testid="call-members"]')?.textContent).toBe('AZNE');
    // already in it: the button shows the call instead of joining it
    expect(screen.getByRole('button', { name: 'Ver chamada' })).toBeInTheDocument();
  });

  it('opens the lead friend\'s profile from the card header', async () => {
    const onOpenProfile = vi.fn();
    renderPanel([inCall('ana', 'Ana')], ['ana'], vi.fn(), null, onOpenProfile);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Ver perfil de Ana' }));
    expect(onOpenProfile).toHaveBeenCalledWith('ana');
  });

  it('shows what a friend is playing, with the game\'s own details and how long it has run', () => {
    const now = Date.now();
    const activity: Activity = {
      key: 'osu', kind: 'playing', name: 'osu!', icon: null, startedAt: new Date(now - 4 * 60_000 - 5_000).toISOString(),
      rich: { details: 'Choosing a beatmap', state: 'Idle', timestamps: { start: now - 4 * 60_000 - 5_000 } },
    };
    const zanmu = { id: 'zan', username: 'zanmu', displayName: 'Zanmu', avatar: '', avatarColor: '', banner: '', bio: '', profileLinks: [], role: 'user' } as PublicUser;
    renderWithRoom(<ActiveNowPanel onOpenProfile={vi.fn()} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } },
      conversations: [], servers: [], friendUserIds: new Set(['zan']), openCall: vi.fn(), activeCallConversationId: null,
      onlineUserIds: new Set(['zan']), allUsers: new Map([['zan', zanmu]]),
      presenceByUser: new Map([['zan', { activity }]]) as never,
    });
    expect(screen.getByText('osu! – 4m')).toBeInTheDocument();
    const game = screen.getByRole('region', { name: 'Jogando osu!' });
    expect(game).toHaveTextContent('Choosing a beatmap');
    expect(game).toHaveTextContent('Idle');
    expect(screen.getByRole('timer')).toHaveTextContent(/^4:0\d decorridos$/);
  });
});

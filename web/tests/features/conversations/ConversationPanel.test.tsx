import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import type { RoomContextValue } from '@/state/RoomContext';
import { ConversationPanel } from '@/features/conversations/ConversationPanel';
import type { Conversation, PublicUser } from '@/shared/types/protocol';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { FriendsProvider } from '@/features/friends/FriendsContext';
import { renderSocial } from '@tests/fixtures/socialFixture';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRelationship: vi.fn(), fetchRequestSummary: vi.fn(),
}));
const mockedApi = vi.mocked(api);

// the direct-conversation gate needs the friends provider — covered by its
// own tests (tests/features/friends/DirectComposerGate.test.tsx)
vi.mock('@/features/friends/DirectComposerGate', () => ({ DirectComposerGate: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const joinedState = { ...initialRoomState, joined: true };

describe('ConversationPanel — call button', () => {
  const direct: Conversation = {
    id: 'c1', type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'peer'],
    lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0,
  };
  const me = { ...joinedState, me: { ...initialRoomState.me, userId: 'me' } };

  function renderPanel(room: Partial<RoomContextValue>) {
    const onOpenCall = vi.fn();
    renderSocial(
      <SidebarProvider>
        <ConversationPanel onOpenProfile={() => {}} onOpenCall={onOpenCall} onOpenSearch={() => {}} detailsOpen={false} mediaOpen={false} onOpenDetails={() => {}} onToggleDetails={() => {}} onToggleMedia={() => {}} />
      </SidebarProvider>,
      { room: { state: me, conversations: [direct], activeConversationId: 'c1', ...room } },
    );
    return { onOpenCall };
  }

  afterEach(() => { vi.clearAllMocks(); });

  it('friends: the button connects normally', async () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    const { onOpenCall } = renderPanel({});
    await vi.waitFor(() => expect(mockedApi.fetchRelationship).toHaveBeenCalled());
    fireEvent.click(screen.getAllByRole('button', { name: 'Entrar na chamada' })[0]!);
    expect(onOpenCall).toHaveBeenCalledWith('c1');
  });

  it('already in this call: the button says Voltar à chamada and still opens the stage', async () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    const { onOpenCall } = renderPanel({ activeCallConversationId: 'c1' });
    await vi.waitFor(() => expect(screen.getAllByRole('button', { name: 'Voltar à chamada' })[0]).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Voltar à chamada' })[0]!);
    expect(onOpenCall).toHaveBeenCalledWith('c1');
  });

  it('non-friend: the button stays disabled', async () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'none', retryAfter: null });
    const { onOpenCall } = renderPanel({});
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Entrar na chamada' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na chamada' }));
    expect(onOpenCall).not.toHaveBeenCalled();
  });

  it('shows the error for a call that failed to start, only in its own conversation', () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    const dispatch = vi.fn();
    renderPanel({ dispatch, state: { ...me, callJoinError: { conversationId: 'c1', message: 'Vídeo/voz indisponível no momento.' } } });
    expect(screen.getByRole('alert')).toHaveTextContent('Vídeo/voz indisponível no momento.');
    fireEvent.click(screen.getByLabelText('Dispensar aviso'));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CALL_JOIN_ERROR', error: null });
  });

  it("a call error from another conversation doesn't show up here", () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    renderPanel({ state: { ...me, callJoinError: { conversationId: 'outra', message: 'falhou' } } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('ConversationPanel — DM subtitle', () => {
  const direct: Conversation = {
    id: 'c1', type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'peer'],
    lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0,
  };
  const peer: PublicUser = {
    id: 'peer', username: 'peer', displayName: 'Peer', avatar: '', avatarColor: 'blurple',
    banner: '', bio: '', profileLinks: [], role: 'user', lastSeenAt: new Date(2026, 9, 24, 14, 32).toISOString(),
  };
  const me = { ...joinedState, me: { ...initialRoomState.me, userId: 'me' } };

  function renderDm(online: boolean, lastSeenAt: string | null) {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    mockedApi.fetchRelationship.mockResolvedValue({ relation: 'friends', retryAfter: null });
    renderSocial(
      <SidebarProvider>
        <ConversationPanel onOpenProfile={() => {}} onOpenCall={() => {}} onOpenSearch={() => {}} detailsOpen={false} mediaOpen={false} onOpenDetails={() => {}} onToggleDetails={() => {}} onToggleMedia={() => {}} />
      </SidebarProvider>,
      {
        room: {
          state: me, conversations: [direct], activeConversationId: 'c1',
          allUsers: new Map([['peer', { ...peer, lastSeenAt }]]),
          onlineUserIds: new Set(online ? ['peer'] : []),
        },
      },
    );
  }

  afterEach(() => { vi.clearAllMocks(); });

  it('shows Online when the peer is connected', () => {
    renderDm(true, peer.lastSeenAt ?? null);
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('shows last seen when the peer is offline', () => {
    renderDm(false, new Date(2026, 9, 24, 14, 32).toISOString());
    expect(screen.getByText(/^Última vez online /)).toBeInTheDocument();
  });

  it('falls back to Offline without a timestamp', () => {
    renderDm(false, null);
    expect(screen.getByText('Offline')).toBeInTheDocument();
  });
});

describe('ConversationPanel — right panel buttons', () => {
  const group: Conversation = {
    id: 'g1', type: 'group', title: 'Time', avatar: '', createdBy: 'me', memberIds: ['me', 'peer'],
    lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'owner', ownerId: 'me', memberCount: 2,
  };
  const me = { ...joinedState, me: { ...initialRoomState.me, userId: 'me' } };

  function renderGroup(detailsOpen: boolean) {
    const onToggleDetails = vi.fn();
    const onOpenDetails = vi.fn();
    renderSocial(
      <SidebarProvider>
        <ConversationPanel onOpenProfile={() => {}} onOpenCall={() => {}} onOpenSearch={() => {}} detailsOpen={detailsOpen} mediaOpen={false} onOpenDetails={onOpenDetails} onToggleDetails={onToggleDetails} onToggleMedia={() => {}} />
      </SidebarProvider>,
      { room: { state: me, conversations: [group], activeConversationId: 'g1' } },
    );
    // the avatar opens the details too; the header's toggle is the pressable one
    const toggle = screen.getAllByRole('button', { name: 'Detalhes do grupo' }).find((button) => button.hasAttribute('aria-pressed'))!;
    return { toggle, onToggleDetails, onOpenDetails };
  }

  afterEach(() => { vi.clearAllMocks(); });

  it('the details button toggles instead of only opening, and reads as pressed while the panel shows', () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    const { toggle, onToggleDetails, onOpenDetails } = renderGroup(true);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(onToggleDetails).toHaveBeenCalledTimes(1);
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  it('closed, the details button is not pressed', () => {
    mockedApi.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
    const { toggle } = renderGroup(false);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('ConversationPanel — phone list route', () => {
  const group: Conversation = {
    id: 'g1', type: 'group', title: 'Squad', avatar: '', createdBy: null, memberIds: ['me'],
    lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 1,
  };

  function renderAt(path: string) {
    renderSocial(
      <SidebarProvider>
        <ConversationPanel onOpenProfile={() => {}} onOpenCall={() => {}} onOpenSearch={() => {}} detailsOpen={false} mediaOpen={false} onOpenDetails={() => {}} onToggleDetails={() => {}} onToggleMedia={() => {}} />
      </SidebarProvider>,
      { path, room: { state: joinedState, conversations: [group], activeConversationId: 'g1' } },
    );
  }

  afterEach(() => { vi.restoreAllMocks(); });

  // the list route hides the panel; a chat mounted there settled at zero
  // height and opened mid-history once shown
  it('does not mount the active conversation behind the list', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 767px)', media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList);
    renderAt('/app/conversations');
    expect(screen.queryByRole('button', { name: 'Voltar para conversas' })).not.toBeInTheDocument();
  });

  it('mounts the conversation the route names', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: query === '(max-width: 767px)', media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    }) as MediaQueryList);
    renderAt('/app/conversations/g1');
    expect(screen.getByRole('button', { name: 'Voltar para conversas' })).toBeInTheDocument();
  });
});

describe('ConversationPanel — phone Voltar', () => {
  const group: Conversation = {
    id: 'g1', type: 'group', title: 'Squad', avatar: '', createdBy: null, memberIds: ['me'],
    lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 1,
  };
  function WhereAmI() {
    return <output data-testid="where">{`${useNavigationType()} ${useLocation().pathname}`}</output>;
  }
  function renderFrom(entries: Parameters<typeof MemoryRouter>[0]['initialEntries']) {
    renderWithRoom(
      <MemoryRouter initialEntries={entries} initialIndex={(entries?.length ?? 1) - 1}>
        <FriendsProvider>
          <SidebarProvider>
            <ConversationPanel onOpenProfile={() => {}} onOpenCall={() => {}} onOpenSearch={() => {}} detailsOpen={false} mediaOpen={false} onOpenDetails={() => {}} onToggleDetails={() => {}} onToggleMedia={() => {}} />
          </SidebarProvider>
          <WhereAmI />
        </FriendsProvider>
      </MemoryRouter>,
      { state: joinedState, conversations: [group], activeConversationId: 'g1' },
    );
  }

  // the same place an iPhone back swipe lands
  it('opened from the list, it steps back to that entry', () => {
    renderFrom(['/app/conversations', { pathname: '/app/conversations/g1', state: { from: '/app/conversations' } }]);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para conversas' }));
    expect(screen.getByTestId('where')).toHaveTextContent('POP /app/conversations');
  });

  it('opened from elsewhere, the list takes its place', () => {
    renderFrom(['/app/notifications', '/app/conversations/g1']);
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para conversas' }));
    expect(screen.getByTestId('where')).toHaveTextContent('REPLACE /app/conversations');
  });
});

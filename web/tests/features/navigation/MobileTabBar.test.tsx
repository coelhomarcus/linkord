import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation, useNavigationType } from 'react-router';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { MobileTabBar } from '@/features/navigation/MobileTabBar';
import { NotificationStateProvider } from '@/features/notifications/NotificationStateProvider';
import { initialRoomState } from '@/state/roomReducer';
import type { Conversation, ServerSummary } from '@/shared/types/protocol';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRequestSummary: vi.fn(), fetchUnreadNotificationCount: vi.fn(),
}));
const mocked = vi.mocked(api);
const conversation: Conversation = {
  id: 'c1', type: 'text', title: 'Equipe', serverId: 's1', memberIds: [], lastMessageAt: null,
  createdAt: 0, updatedAt: 0, pinnedAt: null,
};
const direct: Conversation = { ...conversation, id: 'd1', type: 'direct', title: '', serverId: null, memberIds: ['me', 'ana'] };
const server: ServerSummary = {
  id: 's1', name: 'Equipe', icon: '', ownerId: 'me', status: 'active', createdAt: 0, memberCount: 2, position: 0,
  permissions: 0, myRoleIds: [], roles: [], categories: [],
  channels: [{ id: 'c1', serverId: 's1', type: 'text', name: 'geral', topic: '', categoryId: null, position: 0, permissionsSynced: true, permissions: 0 }],
};

beforeEach(() => {
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
  mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 3 });
});

function WhereAmI() {
  return <output data-testid="where">{`${useNavigationType()} ${useLocation().pathname}`}</output>;
}

function renderBar(callId: string | null = null, onReturnToCall = vi.fn()) {
  return renderSocial(
    <NotificationStateProvider><MobileTabBar activeCallConversationId={callId} onReturnToCall={onReturnToCall} /><WhereAmI /></NotificationStateProvider>,
    {
      path: '/app/friends',
      room: {
        state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Mar' } },
        conversations: [conversation, direct], servers: [server], unreadByConversation: new Map([['c1', 2], ['d1', 1]]),
      },
    },
  );
}

describe('MobileTabBar', () => {
  it('links to four top-level pages with active state and unread badges', async () => {
    renderBar();
    const links = screen.getAllByRole('link');
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/app/channels/s1', '/app/channels/@me', '/app/notifications', '/app/profile']);
    expect(screen.getByRole('link', { name: /^Mensagens/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Servidores, 2 não lidas' })).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: 'Mensagens, 1 não lida' })).toHaveTextContent('1');
    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('shows an active call above the tabs and returns to its stage', async () => {
    const onReturnToCall = vi.fn();
    renderBar('c1', onReturnToCall);
    await userEvent.setup().click(screen.getByRole('button', { name: /Em chamada: Equipe/ }));
    expect(onReturnToCall).toHaveBeenCalledOnce();
  });

  // siblings: a back swipe leaves the section instead of replaying every tab
  it('switching tabs replaces the history entry', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByRole('link', { name: /^Servidores/ }));
    expect(screen.getByTestId('where')).toHaveTextContent('REPLACE /app/channels/s1');
  });
});

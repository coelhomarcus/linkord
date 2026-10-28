import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Location } from 'react-router';
import { initialRoomState } from '@/state/roomReducer';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';
import { ContentLocationProvider } from '@/shared/lib/contentLocation';
import { AppTopBar } from '@/features/navigation/AppTopBar';
import type { Conversation } from '@/shared/types/protocol';
import type { RoomContextValue } from '@/state/RoomContext';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRequestSummary: vi.fn(), fetchUnreadNotificationCount: vi.fn(), fetchNotifications: vi.fn(),
}));
const mocked = vi.mocked(api);
beforeEach(() => {
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
  mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 0 });
  mocked.fetchNotifications.mockResolvedValue({ items: [], nextCursor: null });
});

const me = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Eu' } };
const base = { avatar: '', createdBy: 'me', lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member' as const, ownerId: null };
const dm: Conversation = { ...base, id: 'dm', type: 'direct', title: '', memberIds: ['me', 'u2'], memberCount: 2 };
const group: Conversation = { ...base, id: 'g', type: 'group', title: 'Covil do Pochita', memberIds: ['me', 'u2', 'u3', 'u4'], memberCount: 4 };

function renderBar(path: string, room: Partial<RoomContextValue> = {}) {
  return renderSocial(<TooltipProvider><AppTopBar /></TooltipProvider>, {
    path, room: { state: me, conversations: [dm, group], onlineUserIds: new Set(['u2']), ...room },
  });
}

const title = () => screen.getByRole('banner').querySelector('p')!;

describe('AppTopBar', () => {
  it('names the friends page', () => {
    renderBar('/app/friends');
    expect(title()).toHaveTextContent('Amigos');
  });

  it('on the conversations page with nothing open: Conversas', () => {
    renderBar('/app/conversations');
    expect(title()).toHaveTextContent('Conversas');
  });

  it('with a direct conversation open: Mensagens diretas', () => {
    renderBar('/app/conversations', { activeConversationId: 'dm' });
    expect(title()).toHaveTextContent('Mensagens diretas');
  });

  it("with a group open: the group's name and how many members are online, you included", () => {
    renderBar('/app/conversations', { activeConversationId: 'g' });
    expect(title()).toHaveTextContent('Covil do Pochita');
    // me + u2 are online, u3 and u4 are not
    expect(screen.getByLabelText('2 membros online')).toHaveTextContent('2');
  });

  it('shows no online count outside a group', () => {
    renderBar('/app/conversations', { activeConversationId: 'dm' });
    expect(screen.queryByLabelText(/online/)).not.toBeInTheDocument();
  });

  it('holds the notifications bell', () => {
    renderBar('/app/friends');
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument();
  });

  it('with a modal open, names the page behind it', () => {
    const behind: Location = { pathname: '/app/friends', search: '', hash: '', state: null, key: 'k' };
    renderSocial(
      <TooltipProvider><ContentLocationProvider value={behind}><AppTopBar /></ContentLocationProvider></TooltipProvider>,
      { path: '/app/settings/av', room: { state: me, conversations: [dm, group] } },
    );
    expect(title()).toHaveTextContent('Amigos');
  });
});

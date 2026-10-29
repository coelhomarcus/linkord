import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { initialRoomState } from '@/state/roomReducer';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { MobileTabBar } from '@/features/navigation/MobileTabBar';
import type { Conversation } from '@/shared/types/protocol';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRequestSummary: vi.fn(),
}));
const mocked = vi.mocked(api);
const me = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'me', name: 'fulana', displayName: 'Fulana' } };

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function renderBar(path = '/app/conversations', roomOverrides: Partial<import('@/state/RoomContext').RoomContextValue> = {}) {
  const onOpenMobileChange = vi.fn();
  renderSocial(
    <SidebarProvider openMobile={false} onOpenMobileChange={onOpenMobileChange}>
      <MobileTabBar />
      <Where />
    </SidebarProvider>,
    { room: { state: me, ...roomOverrides }, path },
  );
  return { onOpenMobileChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
});

describe('MobileTabBar', () => {
  it('reaches every home screen and the account from the bottom of the screen', () => {
    renderBar();
    expect(screen.getByRole('link', { name: 'Conversas' })).toHaveAttribute('data-to', '/app/conversations');
    expect(screen.getByRole('link', { name: 'Amigos' })).toHaveAttribute('data-to', '/app/friends');
    expect(screen.getByRole('button', { name: 'Você' })).toBeInTheDocument();
  });

  it.each([
    ['/app/conversations', 'Conversas'],
    ['/app/friends', 'Amigos'],
  ])('at %s only "%s" is marked as the current page', (path, current) => {
    renderBar(path);
    for (const name of ['Conversas', 'Amigos']) {
      const link = screen.getByRole('link', { name });
      if (name === current) expect(link).toHaveAttribute('aria-current', 'page');
      else expect(link).not.toHaveAttribute('aria-current');
    }
  });

  it('the list comes up for Conversas; friends is the page under it', async () => {
    const user = userEvent.setup();
    const { onOpenMobileChange } = renderBar('/app/friends');
    await user.click(screen.getByRole('link', { name: 'Conversas' }));
    expect(onOpenMobileChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole('link', { name: 'Amigos' }));
    expect(onOpenMobileChange).toHaveBeenLastCalledWith(false);
  });

  it('"Você" opens the settings', async () => {
    renderBar();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Você' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings');
  });

  it('counts what is unread in every kind of conversation, bots included', () => {
    const conversation = (id: string, type: Conversation['type']) => ({ id, type, title: id, memberIds: ['me'] }) as unknown as Conversation;
    renderBar('/app/conversations', {
      conversations: [conversation('d', 'direct'), conversation('g', 'group'), conversation('b', 'bot')],
      unreadByConversation: new Map([['d', 2], ['g', 1], ['b', 4]]),
    });
    expect(screen.getByRole('link', { name: 'Conversas, 7 não lidas' })).toBeInTheDocument();
  });
});

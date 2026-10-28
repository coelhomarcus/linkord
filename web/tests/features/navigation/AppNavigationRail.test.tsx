import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';
import { AppNavigationRail } from '@/features/navigation/AppNavigationRail';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRequestSummary: vi.fn(), fetchUnreadNotificationCount: vi.fn(), fetchNotifications: vi.fn(),
}));
const mocked = vi.mocked(api);
const me = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'me', name: 'fulana', displayName: 'Fulana' } };

/** Pretends the window is `width` wide for the `(max-width: Npx)` queries the sidebar reads. */
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}
const originalMatchMedia = window.matchMedia;

function renderRail(path = '/app/conversations', open = true, openMobile = false, roomOverrides: Partial<import('@/state/RoomContext').RoomContextValue> = {}) {
  const onOpenChange = vi.fn();
  const onOpenMobileChange = vi.fn();
  renderSocial(
    <TooltipProvider>
      <SidebarProvider open={open} onOpenChange={onOpenChange} openMobile={openMobile} onOpenMobileChange={onOpenMobileChange}>
        <AppNavigationRail />
      </SidebarProvider>
    </TooltipProvider>,
    { room: { state: me, ...roomOverrides }, path },
  );
  return { onOpenChange, onOpenMobileChange };
}

afterEach(() => { window.matchMedia = originalMatchMedia; });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
  mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 0 });
  mocked.fetchNotifications.mockResolvedValue({ items: [], nextCursor: null });
});

describe('AppNavigationRail', () => {
  it('has the global destinations and no Solicitacoes shortcut', () => {
    renderRail();
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conversas' })).toHaveAttribute('data-to', '/app/conversations');
    expect(screen.getByRole('link', { name: 'Amigos' })).toHaveAttribute('data-to', '/app/friends');
    expect(screen.queryByRole('link', { name: 'Ajustes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meu perfil' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Solicitações/ })).not.toBeInTheDocument();
  });

  it('never carries the notifications bell: it lives in the top bar', () => {
    renderRail('/app/conversations', true);
    expect(screen.queryByRole('button', { name: /Notificações/ })).not.toBeInTheDocument();
  });

  it('with the list collapsed, the show-list button comes first and there is still no bell', () => {
    renderRail('/app/conversations', false);
    expect(screen.queryByRole('button', { name: /Notificações/ })).not.toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(nav.querySelector('a, button')).toHaveAccessibleName('Mostrar lista de conversas');
  });

  it.each([
    ['/app/conversations/abc', 'Conversas'],
    ['/app/friends?tab=pending', 'Amigos'],
  ])('at %s only "%s" is marked as the current page', (path, current) => {
    renderRail(path);
    const marked = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.getAttribute('aria-label'));
    expect(marked).toEqual([current]);
  });

  it.each(['/app/settings/av', '/admin/users'])('at %s no rail item is marked as the current page', (path) => {
    renderRail(path);
    expect(screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page')).toEqual([]);
  });

  it('the Amigos badge sums requests and received invitations, and the accessible name says what counts', async () => {
    mocked.fetchRequestSummary.mockResolvedValue({ incoming: 2, invitations: 1 });
    renderRail();
    expect(await screen.findByRole('link', { name: 'Amigos, 3 aguardando resposta' })).toBeInTheDocument();
  });

  it('with the list open, the rail does not repeat the hide button (it stays in the list header)', () => {
    renderRail('/app/conversations', true);
    expect(screen.queryByRole('button', { name: /lista de conversas/ })).not.toBeInTheDocument();
  });

  it('with the list collapsed, the rail offers a way back', async () => {
    const { onOpenChange } = renderRail('/app/conversations', false);
    const toggle = screen.getByRole('button', { name: 'Mostrar lista de conversas' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('does not put a return-to-call control on the rail, even during an active call', () => {
    const group = {
      id: 'conv-1', type: 'group' as const, title: 'os xerecas', avatar: '', createdBy: 'me', memberIds: ['me'],
      lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'owner' as const, ownerId: 'me', memberCount: 1,
    };
    renderRail('/app/conversations', true, false, { activeCallConversationId: 'conv-1', conversations: [group] });
    expect(screen.queryByRole('button', { name: /Voltar para/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Voltar à chamada/ })).not.toBeInTheDocument();
  });

  it('has no settings or administration shortcut, not even for an admin (both live in the user dock and in settings)', () => {
    renderRail('/app/conversations', true, false, { state: { ...me, me: { ...me.me, role: 'admin' as const } } });
    expect(screen.queryByRole('link', { name: 'Ajustes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Área administrativa' })).not.toBeInTheDocument();
  });
});

describe('AppNavigationRail — window width', () => {
  it('desktop (>= 1024): the list is a column; the rail only offers "show" if it is collapsed', () => {
    setViewport(1440);
    renderRail('/app/conversations', true);
    expect(screen.queryByRole('button', { name: 'Mostrar lista de conversas' })).not.toBeInTheDocument();
  });

  it('tablet (768-1023): the list is a drawer opened by the rail, which does not change the collapse preference', async () => {
    setViewport(900);
    const { onOpenChange, onOpenMobileChange } = renderRail('/app/conversations', true, false);
    const toggle = screen.getByRole('button', { name: 'Mostrar lista de conversas' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(toggle);
    expect(onOpenMobileChange).toHaveBeenCalledWith(true);
    expect(onOpenChange).not.toHaveBeenCalled(); // the saved collapsed/expanded preference is untouched
  });

  it('tablet: with the drawer open, the button says expanded', () => {
    setViewport(900);
    renderRail('/app/conversations', true, true);
    expect(screen.getByRole('button', { name: 'Mostrar lista de conversas' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('navigating via the rail with the drawer open closes the drawer', async () => {
    setViewport(900);
    const { onOpenMobileChange } = renderRail('/app/conversations', true, true);
    await userEvent.setup().click(screen.getByRole('link', { name: 'Amigos' }));
    expect(onOpenMobileChange).toHaveBeenCalledWith(false);
  });

  it('desktop: navigating via the rail does not touch any drawer', async () => {
    setViewport(1440);
    const { onOpenMobileChange } = renderRail('/app/conversations', true, false);
    await userEvent.setup().click(screen.getByRole('link', { name: 'Amigos' }));
    expect(onOpenMobileChange).not.toHaveBeenCalledWith(false);
  });
});

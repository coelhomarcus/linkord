import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { ServerRail } from '@/features/servers/ServerRail';
import type { Participant, ServerSummary } from '@/shared/types/protocol';
import type { RoomContextValue } from '@/state/RoomContext';
import { initialRoomState } from '@/state/roomReducer';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

const server = { id: 's1', name: 'Squad', icon: '', status: 'active', roles: [], categories: [], channels: [] } as unknown as ServerSummary;

function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = (max ? width <= Number(max[1]) : true) && (min ? width >= Number(min[1]) : true);
    return { matches, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

function Where() { return <p data-testid="where">{useLocation().pathname}</p>; }

function renderRail(onOpenMobileChange = vi.fn(), servers: ServerSummary[] = [server], room: Partial<RoomContextValue> = {}) {
  renderSocial(
    <SidebarProvider open onOpenChange={vi.fn()} openMobile={false} onOpenMobileChange={onOpenMobileChange}>
      <ServerRail /><Where />
    </SidebarProvider>,
    { room: { servers, ...room }, path: '/app/channels/@me' },
  );
  return onOpenMobileChange;
}

const withChannels = {
  ...server,
  channels: [
    { id: 'c-text', type: 'text', name: 'geral', categoryId: null, position: 0 },
    { id: 'c-voice', type: 'voice', name: 'Voz', categoryId: null, position: 1 },
  ],
} as unknown as ServerSummary;

function inCall(callConversationId: string | null): Participant {
  return {
    id: 'p-bea', userId: 'u-bea', name: 'bea', displayName: 'Bea', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId,
    micActivated: false, micMuted: true, cameraOn: false, sharing: false, speaking: false,
  };
}

function withParticipants(...participants: Participant[]): Partial<RoomContextValue> {
  return { state: { ...initialRoomState, participants: new Map(participants.map((p) => [p.id, p])) } };
}

describe('ServerRail', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  it('a server opens at its URL', async () => {
    setViewport(1440);
    renderRail();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Squad' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/channels/s1');
    expect(screen.queryByRole('button', { name: 'Mostrar canais e conversas' })).not.toBeInTheDocument();
  });

  it('on a tablet the column is a drawer the rail opens, also when a server is picked', async () => {
    setViewport(900);
    const onOpenMobileChange = renderRail();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Mostrar canais e conversas' }));
    expect(onOpenMobileChange).toHaveBeenLastCalledWith(true);
    onOpenMobileChange.mockClear();
    await user.click(screen.getByRole('button', { name: 'Squad' }));
    expect(onOpenMobileChange).toHaveBeenLastCalledWith(true);
  });

  it('servers are handles of a sortable list', () => {
    setViewport(1440);
    renderRail();
    expect(screen.getByRole('button', { name: 'Squad' })).toHaveAttribute('aria-roledescription', 'sortable');
  });

  // the browser's own image drag would take the pointer away from the reorder
  it('never starts a native drag from a server or its picture', () => {
    setViewport(1440);
    renderRail(vi.fn(), [{ ...server, icon: '/uploads/squad.png' }]);
    const button = screen.getByRole('button', { name: 'Squad' });
    expect(button.querySelector('img')).toHaveAttribute('draggable', 'false');
    const dragStart = createEvent.dragStart(button);
    fireEvent(button, dragStart);
    expect(dragStart.defaultPrevented).toBe(true);
  });
});

describe('ServerRail — live call seal', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  it('shows while someone else is in one of its voice channels, with you in no call', () => {
    setViewport(1440);
    renderRail(vi.fn(), [withChannels], withParticipants(inCall('c-voice')));
    const button = screen.getByRole('button', { name: 'Squad, Chamada de voz em andamento' });
    expect(within(button).getByTestId('live-call-seal')).toHaveClass('-top-1', '-right-1');
  });

  it('shows while you are the one in its call', () => {
    setViewport(1440);
    renderRail(vi.fn(), [withChannels], { activeCallConversationId: 'c-voice' });
    expect(screen.getByRole('button', { name: 'Squad, Chamada de voz em andamento' })).toBeInTheDocument();
  });

  it('is gone once nobody is in the channel', () => {
    setViewport(1440);
    renderRail(vi.fn(), [withChannels], withParticipants(inCall(null)));
    expect(screen.getByRole('button', { name: 'Squad' })).toBeInTheDocument();
    expect(screen.queryByTestId('live-call-seal')).not.toBeInTheDocument();
  });

  it("a call in a DM or another server's channel doesn't light this one", () => {
    setViewport(1440);
    renderRail(vi.fn(), [withChannels], withParticipants(inCall('dm-1'), { ...inCall('elsewhere-voice'), id: 'p-luis' }));
    expect(screen.queryByTestId('live-call-seal')).not.toBeInTheDocument();
  });
});

describe('ServerRail — unread messages', () => {
  const original = window.matchMedia;
  afterEach(() => { window.matchMedia = original; });

  it('a red count shows how many messages arrived, in its own corner beside the call seal', () => {
    setViewport(1440);
    renderRail(vi.fn(), [withChannels], { ...withParticipants(inCall('c-voice')), unreadByConversation: new Map([['c-text', 3]]) });
    const button = screen.getByRole('button', { name: 'Squad, 3 mensagens não lidas, Chamada de voz em andamento' });
    const count = within(button).getByText('3');
    expect(count).toHaveClass('bg-red', '-bottom-1', '-right-1');
    expect(within(button).getByTestId('live-call-seal')).toHaveClass('-top-1');
  });

  it('caps the count at 99+', () => {
    setViewport(1440);
    renderRail(vi.fn(), [withChannels], { unreadByConversation: new Map([['c-text', 120]]) });
    expect(within(screen.getByRole('button', { name: 'Squad, 120 mensagens não lidas' })).getByText('99+')).toBeInTheDocument();
  });

  it('nothing unread, no count', () => {
    setViewport(1440);
    renderRail(vi.fn(), [withChannels], { unreadByConversation: new Map([['c-text', 0]]) });
    expect(screen.getByRole('button', { name: 'Squad' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  describe('in English', () => {
    useLanguageForTests('en-US');

    it('names the count and the call in English', () => {
      setViewport(1440);
      renderRail(vi.fn(), [withChannels], { activeCallConversationId: 'c-voice', unreadByConversation: new Map([['c-text', 1]]) });
      expect(screen.getByRole('button', { name: 'Squad, 1 unread message, Voice call in progress' })).toBeInTheDocument();
    });
  });
});

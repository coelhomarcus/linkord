import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar';
import { channelConversation } from '@/features/servers/useServersList';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import { initialRoomState } from '@/state/roomReducer';
import type { Conversation, Participant, PublicUser, ServerSummary } from '@/shared/types/protocol';

const meState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'me', name: 'fulana', displayName: 'Fulana' } };
const bea: PublicUser = { id: 'u-bea', username: 'bea', displayName: 'Bea', avatar: '', avatarColor: 'green', banner: '', bio: '', profileLinks: [], role: 'user' as const };
const caio: PublicUser = { ...bea, id: 'u-caio', username: 'caio', displayName: 'Caio' };

const direct = (id: string, peer: string): Conversation => ({
  id, type: 'direct', title: '', serverId: null, memberIds: ['me', peer], lastMessageAt: Date.now(), createdAt: 0, updatedAt: 0, pinnedAt: null,
});

const everyone = PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.SEND_MESSAGES | PERMISSIONS.CONNECT | PERMISSIONS.CREATE_INVITE;
const server: ServerSummary = {
  id: 's1', name: 'Os Xerecas', icon: '', ownerId: 'u-bea', status: 'active', createdAt: 0, memberCount: 3, position: 0,
  permissions: everyone, myRoleIds: [], roles: [],
  categories: [{ id: 'cat-text', name: 'Canais de texto', position: 0 }, { id: 'cat-voice', name: 'Canais de voz', position: 1 }],
  channels: [
    { id: 'ch-geral', serverId: 's1', type: 'text', name: 'geral', topic: '', categoryId: 'cat-text', position: 0, permissionsSynced: true, permissions: everyone },
    { id: 'ch-voz', serverId: 's1', type: 'voice', name: 'Geral', topic: '', categoryId: 'cat-voice', position: 0, permissionsSynced: true, permissions: everyone },
  ],
};

function inVoice(): Participant {
  return {
    id: 'p-bea', userId: 'u-bea', name: 'bea', displayName: 'Bea', avatar: '', avatarPoster: '', avatarColor: 'green', banner: '', bannerPoster: '', bio: '', profileLinks: [],
    role: 'user', deafened: false, callConversationId: 'ch-voz', micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
  };
}

function CurrentPath() { return <span data-testid="current-path">{useLocation().pathname}</span>; }

function renderSidebar(path = '/app/channels/@me', overrides: { unreadByConversation?: Map<string, number>; participants?: Map<string, Participant>; openCall?: () => void; activeCallConversationId?: string | null } = {}) {
  const conversations = [direct('dm-bea', 'u-bea'), direct('dm-caio', 'u-caio'), ...server.channels.map((c) => channelConversation(server, c))];
  return renderSocial(
    <SidebarProvider open onOpenChange={vi.fn()} openMobile={false} onOpenMobileChange={vi.fn()}>
      <ConversationSidebar onOpenProfile={vi.fn()} />
      <CurrentPath />
    </SidebarProvider>,
    {
      room: {
        state: { ...meState, participants: overrides.participants ?? new Map() },
        conversations,
        servers: [server],
        allUsers: new Map([['u-bea', bea], ['u-caio', caio]]),
        unreadByConversation: overrides.unreadByConversation ?? new Map(),
        ...(overrides.activeCallConversationId !== undefined ? { activeCallConversationId: overrides.activeCallConversationId } : {}),
        ...(overrides.openCall ? { openCall: overrides.openCall } : {}),
      },
      path,
    },
  );
}

function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}

describe('ConversationSidebar — home', () => {
  it('lists Friends and the DMs by the other person, never a channel', () => {
    renderSidebar();
    expect(screen.getByRole('button', { name: /Amigos/ })).toBeInTheDocument();
    expect(screen.getByText('Mensagens diretas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bea' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Caio' })).toBeInTheDocument();
    expect(screen.queryByText('geral')).not.toBeInTheDocument();
  });

  it('opens a DM at its home URL', async () => {
    renderSidebar();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Bea' }));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/app/channels/@me/dm-bea');
  });

  it('filters the DMs by name', async () => {
    renderSidebar();
    await userEvent.setup().type(screen.getByRole('textbox', { name: 'Encontre ou comece uma conversa' }), 'cai');
    expect(screen.queryByRole('button', { name: 'Bea' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Caio' })).toBeInTheDocument();
  });

  it('shows that this DM is in a call', () => {
    renderSidebar('/app/channels/@me', { activeCallConversationId: 'dm-bea' });
    expect(screen.getByRole('button', { name: 'Bea' })).toHaveTextContent('Em uma chamada');
    expect(screen.getByRole('button', { name: 'Caio' })).not.toHaveTextContent('Em uma chamada');
  });

  it('shows a DM\'s unread count on its row', () => {
    renderSidebar('/app/channels/@me', { unreadByConversation: new Map([['dm-bea', 3]]) });
    const row = screen.getByRole('button', { name: 'Bea, 3 não lidas' }).closest('li');
    expect(row).toHaveTextContent('3');
  });
});

describe('ConversationSidebar — a server', () => {
  it('shows the server, its categories and channels, and who is in each voice channel', () => {
    renderSidebar('/app/channels/s1/ch-geral', { participants: new Map([['p-bea', inVoice()]]) });
    expect(screen.getByText('Os Xerecas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Canais de texto/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'geral' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Geral' })).toBeInTheDocument();
    expect(screen.getByText('Bea')).toBeInTheDocument();
    expect(screen.queryByText('Mensagens diretas')).not.toBeInTheDocument();
  });

  it('a text channel opens at its URL; a voice channel joins its call', async () => {
    const openCall = vi.fn();
    renderSidebar('/app/channels/s1/ch-geral', { openCall });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Geral' }));
    expect(openCall).toHaveBeenCalledWith('ch-voz');
    await user.click(screen.getByRole('button', { name: 'geral' }));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/app/channels/s1/ch-geral');
  });

  it('collapsing a category hides its channels', async () => {
    renderSidebar('/app/channels/s1/ch-geral');
    await userEvent.setup().click(screen.getByRole('button', { name: /Canais de voz/ }));
    expect(screen.queryByRole('button', { name: 'Geral' })).not.toBeInTheDocument();
  });
});

describe('ConversationSidebar — on a phone', () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  it('home is a page with the server rail beside the DMs', () => {
    setViewport(390);
    renderSidebar();
    expect(screen.getByRole('main', { name: 'Mensagens diretas' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Servidores' })).toBeInTheDocument();
  });

  it("a server's page is its channel list, named after it", () => {
    setViewport(390);
    renderSidebar('/app/channels/s1');
    expect(screen.getByRole('main', { name: 'Os Xerecas' })).toHaveTextContent('geral');
  });

  it('is not drawn while a conversation is open', () => {
    setViewport(390);
    renderSidebar('/app/channels/@me/dm-bea');
    expect(screen.queryByRole('main', { name: 'Mensagens diretas' })).not.toBeInTheDocument();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { SidebarProvider } from '@/shared/ui/motion/sidebar';
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar';
import { initialRoomState } from '@/state/roomReducer';
import type { Conversation, ChatMessage, Participant, PublicUser } from '@/shared/types/protocol';

const meState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'me', name: 'fulana', displayName: 'Fulana' } };
const bea: PublicUser = { id: 'u-bea', username: 'bea', displayName: 'Bea', avatar: '', avatarColor: 'green', banner: '', bio: '', profileLinks: [], role: 'user' as const };

function directConversation(): Conversation {
  return {
    id: 'conv-dm', type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'u-bea'],
    lastMessageAt: Date.now(), createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 2,
  };
}

function groupConversation(): Conversation {
  return {
    id: 'conv-group', type: 'group', title: 'os xerecas', avatar: '', createdBy: 'me', memberIds: ['me', 'u-bea'],
    lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'owner', ownerId: 'me', memberCount: 2,
  };
}

function lastMessage(conversationId: string): ChatMessage {
  return { msgId: 1, conversationId, id: 'u-bea', name: 'Bea', avatar: '', text: 'oi, tudo bem?', ts: Date.now() };
}

function callParticipant(): Participant {
  return {
    id: 'p-bea', userId: 'u-bea',
    name: 'bea', displayName: 'Bea', avatar: '', avatarPoster: '', avatarColor: 'green', banner: '', bannerPoster: '', bio: '', profileLinks: [],
    role: 'user', deafened: false, callConversationId: 'conv-group', micActivated: true, micMuted: false, cameraOn: false,
    sharing: false, speaking: false,
  };
}

function CurrentPath() { return <span data-testid="current-path">{useLocation().pathname}</span>; }

function renderSidebar(overrides: {
  activeCallConversationId?: string | null;
  participants?: Map<string, Participant>;
  activeConversationId?: string | null;
  unreadByConversation?: Map<string, number>;
  openMobile?: boolean;
} = {}) {
  const dm = directConversation();
  const group = groupConversation();
  return renderSocial(
    <SidebarProvider open onOpenChange={vi.fn()} openMobile={overrides.openMobile ?? false} onOpenMobileChange={vi.fn()}>
      <ConversationSidebar />
      <CurrentPath />
    </SidebarProvider>,
    {
      room: {
        state: { ...meState, participants: overrides.participants ?? new Map() },
        conversations: [dm, group],
        allUsers: new Map([['u-bea', bea]]),
        messagesByConversation: new Map([['conv-dm', [lastMessage('conv-dm')]]]),
        activeCallConversationId: overrides.activeCallConversationId ?? null,
        activeConversationId: overrides.activeConversationId ?? null,
        unreadByConversation: overrides.unreadByConversation ?? new Map(),
      },
      path: '/app/conversations',
    },
  );
}

async function openGroupsTab() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('tab', { name: 'Grupos' }));
  return user;
}

describe('ConversationSidebar — the conversation row only shows the name (no @, no preview, no "members")', () => {
  it('DM with a message: shows only the display name, not the last message preview', () => {
    renderSidebar();
    expect(screen.getByText('Bea')).toBeInTheDocument();
    expect(screen.queryByText(/tudo bem/)).not.toBeInTheDocument();
    expect(screen.queryByText(/@bea/)).not.toBeInTheDocument();
  });

  it('group with no message: shows only the title, not the member count', async () => {
    renderSidebar();
    await openGroupsTab();
    expect(screen.getByText('os xerecas')).toBeInTheDocument();
    expect(screen.queryByText(/membros/)).not.toBeInTheDocument();
  });

  it("no longer shows the last message's time — just avatar and name, like Discord", () => {
    renderSidebar();
    // 17:32-shaped or similar — any DM/group row's time text is gone entirely.
    expect(screen.queryByText(/^\d{1,2}:\d{2}$/)).not.toBeInTheDocument();
  });

  it('no active call: the conversation row has only one line (the name), nothing below', async () => {
    renderSidebar();
    await openGroupsTab();
    const title = screen.getByText('os xerecas');
    // title's own wrapping <span> has no sibling below it (no second line) —
    // the row only grows a second line when there's a call to show.
    expect(title.parentElement?.children).toHaveLength(1);
  });

  it('group with an active call: a second line appears with who is on the call, in the slot where the date used to be', async () => {
    const participants = new Map([['p-bea', callParticipant()]]);
    renderSidebar({ participants });
    await openGroupsTab();
    const title = screen.getByText('os xerecas');
    // title's row now has a sibling block below it — the call indicator, in
    // the exact slot the removed timestamp used to occupy.
    expect(title.parentElement?.children).toHaveLength(2);
    expect(title.nextElementSibling).not.toBeNull();
    expect(title.nextElementSibling?.textContent).not.toContain('os xerecas');
  });
});

describe('ConversationSidebar — Amigos / Grupos tabs', () => {
  it('opens the detail URL even when the conversation is already active', async () => {
    renderSidebar({ activeConversationId: 'conv-dm' });
    await userEvent.setup().click(screen.getByRole('button', { name: /Bea/ }));
    expect(screen.getByTestId('current-path')).toHaveTextContent('/app/conversations/conv-dm');
  });
  it('defaults to Amigos: shows the DM and hides the group', () => {
    renderSidebar();
    expect(screen.getByText('Bea')).toBeInTheDocument();
    expect(screen.queryByText('os xerecas')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Amigos' })).toHaveAttribute('data-active');
  });

  it('clicking Grupos shows the group and hides the DM', async () => {
    renderSidebar();
    await openGroupsTab();
    expect(screen.getByText('os xerecas')).toBeInTheDocument();
    expect(screen.queryByText('Bea')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Grupos' })).toHaveAttribute('data-active');
  });

  it('search only filters the active tab', async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.type(screen.getByPlaceholderText('Buscar amigos'), 'xerecas');
    expect(screen.getByText('Nenhuma conversa.')).toBeInTheDocument();
    expect(screen.queryByText('os xerecas')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Grupos' }));
    expect(screen.getByPlaceholderText('Buscar grupos')).toBeInTheDocument();
    expect(screen.getByText('os xerecas')).toBeInTheDocument();
    expect(screen.queryByText('Nenhuma conversa.')).not.toBeInTheDocument();
  });

  it('shows an unread count on the Grupos tab when a group has unread', () => {
    renderSidebar({ unreadByConversation: new Map([['conv-group', 3]]) });
    expect(screen.getByRole('tab', { name: 'Grupos' })).toHaveTextContent('3');
    expect(screen.getByRole('tab', { name: 'Amigos' })).not.toHaveTextContent('3');
  });

  it('opens on Grupos when the active conversation is a group', () => {
    renderSidebar({ activeConversationId: 'conv-group' });
    expect(screen.getByText('os xerecas')).toBeInTheDocument();
    expect(screen.queryByText('Bea')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Grupos' })).toHaveAttribute('data-active');
  });
});

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

describe('ConversationSidebar — user dock', () => {
  const originalMatchMedia = window.matchMedia;
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  it('does not draw the dock in the column: from 768px it floats over the rail and the list, drawn by the shell', () => {
    renderSidebar();
    expect(screen.queryByRole('button', { name: 'Meu perfil' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ajustes' })).not.toBeInTheDocument();
  });

  it('on a phone the list fills the page without a drawer or dock', () => {
    setViewport(390);
    renderSidebar();
    expect(screen.getByRole('main', { name: 'Conversas' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Conversas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Meu perfil' })).not.toBeInTheDocument();
  });

  it('does not highlight the active conversation in the phone list', () => {
    setViewport(390);
    renderSidebar({ activeConversationId: 'conv-dm' });
    const row = screen.getByRole('button', { name: /Bea/ });
    expect(row.querySelector('.bg-nav-active')).toBeNull();
  });

  it('keeps the active conversation highlight on desktop', () => {
    setViewport(1280);
    renderSidebar({ activeConversationId: 'conv-dm' });
    const row = screen.getByRole('button', { name: /Bea/ });
    expect(row.querySelector('.bg-nav-active')).not.toBeNull();
  });
});

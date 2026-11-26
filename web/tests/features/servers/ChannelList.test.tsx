import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { ChannelList } from '@/features/servers/ChannelList';
import { moveChannel } from '@/features/servers/serversApi';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import type { ServerSummary } from '@/shared/types/protocol';

vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  moveChannel: vi.fn(),
}));

const manage = PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.CREATE_INVITE;
const server = {
  id: 's1', name: 'Squad', icon: '', status: 'active', permissions: manage, roles: [], categories: [],
  channels: [
    { id: 'c1', serverId: 's1', type: 'text', name: 'geral', topic: '', categoryId: null, position: 0, permissionsSynced: true, permissions: manage },
    { id: 'c2', serverId: 's1', type: 'text', name: 'avisos', topic: '', categoryId: null, position: 1, permissionsSynced: true, permissions: manage },
  ],
} as unknown as ServerSummary;

describe('ChannelList', () => {
  it('reveals a channel\'s invite and settings actions on touch screens, where nothing can be hovered', () => {
    renderSocial(<ChannelList server={server} activeChannelId={null} onOpenProfile={vi.fn()} />, { room: { servers: [server] }, path: '/channels/s1' });
    const settings = screen.getAllByRole('button', { name: 'Editar canal', hidden: true });
    expect(settings).toHaveLength(2);
    expect(settings[0]!.parentElement!.className).toContain('[@media(hover:none)]:flex');
    expect(screen.getAllByRole('button', { name: 'Criar convite', hidden: true })).toHaveLength(2);
  });

  it('marks a text channel read when the unread marker still shows', async () => {
    const markConversationRead = vi.fn();
    renderSocial(<ChannelList server={server} activeChannelId={null} onOpenProfile={vi.fn()} />, {
      room: { servers: [server], unreadStartByConversation: new Map([['c1', 9]]), markConversationRead },
      path: '/channels/s1',
    });

    fireEvent.contextMenu(screen.getByRole('button', { name: 'geral' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Marcar como lida' }));
    expect(markConversationRead).toHaveBeenCalledWith('c1');
  });

  it('restores the original channel order when saving a move fails', async () => {
    let rejectMove!: (error: Error) => void;
    vi.mocked(moveChannel).mockReturnValueOnce(new Promise((_, reject) => { rejectMove = reject; }));
    renderSocial(<ChannelList server={server} activeChannelId={null} onOpenProfile={vi.fn()} />, {
      room: { servers: [server] }, path: '/channels/s1',
    });
    const list = screen.getByRole('navigation', { name: 'Canais' });
    const first = () => within(list).getAllByRole('listitem')[0]!;

    fireEvent.contextMenu(screen.getByRole('button', { name: 'avisos' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Mover para cima' }));
    expect(first()).toHaveAttribute('data-channel-id', 'c2');
    expect(moveChannel).toHaveBeenCalledWith('c2', { categoryId: null, target: { channelId: 'c1', edge: 'before' } });

    rejectMove(new Error('offline'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível mover o canal.');
    expect(first()).toHaveAttribute('data-channel-id', 'c1');
  });

  it('a server with no visible channel offers to create one only to who can', async () => {
    const empty = { ...server, channels: [] } as ServerSummary;
    const { unmount } = renderSocial(<ChannelList server={empty} activeChannelId={null} onOpenProfile={vi.fn()} />, { room: { servers: [empty] }, path: '/channels/s1' });
    expect(screen.getByText('Nenhum canal por aqui')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Criar canal' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    unmount();

    const member = { ...empty, permissions: PERMISSIONS.VIEW_CHANNEL } as ServerSummary;
    renderSocial(<ChannelList server={member} activeChannelId={null} onOpenProfile={vi.fn()} />, { room: { servers: [member] }, path: '/channels/s1' });
    expect(screen.getByText('Quando houver um canal que você possa ver, ele aparece aqui.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar canal' })).not.toBeInTheDocument();
  });
});

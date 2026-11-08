import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { ChannelList } from '@/features/servers/ChannelList';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import type { ServerSummary } from '@/shared/types/protocol';

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
    renderSocial(<ChannelList server={server} activeChannelId={null} onOpenProfile={vi.fn()} />, { room: { servers: [server] }, path: '/app/channels/s1' });
    const settings = screen.getAllByRole('button', { name: 'Editar canal', hidden: true });
    expect(settings).toHaveLength(2);
    expect(settings[0]!.parentElement!.className).toContain('[@media(hover:none)]:flex');
    expect(screen.getAllByRole('button', { name: 'Criar convite', hidden: true })).toHaveLength(2);
  });

  it('a server with no visible channel offers to create one only to who can', async () => {
    const empty = { ...server, channels: [] } as ServerSummary;
    const { unmount } = renderSocial(<ChannelList server={empty} activeChannelId={null} onOpenProfile={vi.fn()} />, { room: { servers: [empty] }, path: '/app/channels/s1' });
    expect(screen.getByText('Nenhum canal por aqui')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Criar canal' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    unmount();

    const member = { ...empty, permissions: PERMISSIONS.VIEW_CHANNEL } as ServerSummary;
    renderSocial(<ChannelList server={member} activeChannelId={null} onOpenProfile={vi.fn()} />, { room: { servers: [member] }, path: '/app/channels/s1' });
    expect(screen.getByText('Quando houver um canal que você possa ver, ele aparece aqui.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar canal' })).not.toBeInTheDocument();
  });
});

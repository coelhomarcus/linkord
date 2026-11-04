import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
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
    renderSocial(<ChannelList server={server} activeChannelId={null} />, { room: { servers: [server] }, path: '/app/channels/s1' });
    const settings = screen.getAllByRole('button', { name: 'Editar canal', hidden: true });
    expect(settings).toHaveLength(2);
    expect(settings[0]!.parentElement!.className).toContain('[@media(hover:none)]:flex');
    expect(screen.getAllByRole('button', { name: 'Criar convite', hidden: true })).toHaveLength(2);
  });
});

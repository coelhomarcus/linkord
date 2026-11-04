import { afterEach, describe, expect, it } from 'vitest';
import { canOpenSettings, firstTextChannel, groupChannels, landingChannel, memberColor, rememberChannel, serverUnread } from '@/features/servers/serverUtils';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import type { ChannelSummary, RoleSummary, ServerSummary } from '@/shared/types/protocol';

const channel = (id: string, over: Partial<ChannelSummary> = {}): ChannelSummary => ({
  id, serverId: 's1', type: 'text', name: id, topic: '', categoryId: null, position: 0, permissionsSynced: true, permissions: 0, ...over,
});
const role = (id: string, over: Partial<RoleSummary> = {}): RoleSummary => ({
  id, name: id, color: '', position: 1, permissions: 0, hoist: false, mentionable: false, isDefault: false, ...over,
});
const server = (over: Partial<ServerSummary> = {}): ServerSummary => ({
  id: 's1', name: 'Squad', icon: '', ownerId: 'u1', status: 'active', createdAt: 0, memberCount: 1, position: 0,
  permissions: 0, myRoleIds: [], roles: [], categories: [], channels: [], ...over,
});

afterEach(() => localStorage.clear());

describe('groupChannels', () => {
  it('puts loose channels first, then categories in order, text above voice', () => {
    const s = server({
      categories: [{ id: 'b', name: 'B', position: 1 }, { id: 'a', name: 'A', position: 0 }],
      channels: [
        channel('voz', { type: 'voice', categoryId: 'a', position: 0 }),
        channel('regras', { categoryId: 'a', position: 1 }),
        channel('geral', { categoryId: 'a', position: 0 }),
        channel('solto'),
        channel('orfao', { categoryId: 'gone' }),
        channel('outro', { categoryId: 'b' }),
      ],
    });
    expect(groupChannels(s).map((g) => [g.category?.id ?? null, g.channels.map((c) => c.id)])).toEqual([
      [null, ['orfao', 'solto']],
      ['a', ['geral', 'regras', 'voz']],
      ['b', ['outro']],
    ]);
  });

  it('the first text channel skips voice channels', () => {
    const s = server({ channels: [channel('voz', { type: 'voice' }), channel('geral', { position: 1 })] });
    expect(firstTextChannel(s)?.id).toBe('geral');
    expect(firstTextChannel(server({ channels: [channel('voz', { type: 'voice' })] }))).toBeNull();
  });
});

describe('landingChannel', () => {
  it('returns to the last text channel visited while it still exists', () => {
    const s = server({ channels: [channel('geral'), channel('memes', { position: 1 })] });
    expect(landingChannel(s)?.id).toBe('geral');
    rememberChannel('s1', 'memes');
    expect(landingChannel(s)?.id).toBe('memes');
    rememberChannel('s1', 'deleted');
    expect(landingChannel(s)?.id).toBe('geral');
  });
});

describe('server helpers', () => {
  it('sums unread over text channels only', () => {
    const s = server({ channels: [channel('geral'), channel('voz', { type: 'voice' })] });
    expect(serverUnread(s, new Map([['geral', 2], ['voz', 5], ['elsewhere', 9]]))).toBe(2);
  });

  it('a name takes the colour of the highest coloured role held', () => {
    const s = server({ roles: [role('mod', { color: '#f00', position: 2 }), role('admin', { color: '#0f0', position: 3 }), role('plain', { position: 4 })] });
    expect(memberColor(s, ['mod', 'admin', 'plain'])).toBe('#0f0');
    expect(memberColor(s, [])).toBe('');
  });

  it('settings open for anyone who can manage something there', () => {
    expect(canOpenSettings(server({ permissions: PERMISSIONS.SEND_MESSAGES }))).toBe(false);
    expect(canOpenSettings(server({ permissions: PERMISSIONS.KICK_MEMBERS }))).toBe(true);
  });
});

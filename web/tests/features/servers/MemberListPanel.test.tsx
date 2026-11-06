import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { groupMembers, MemberListPanel } from '@/features/servers/MemberListPanel';
import * as serversApi from '@/features/servers/serversApi';
import * as api from '@/shared/api/api';
import type { ServerMemberEntry } from '@/features/servers/serversApi';
import type { RoleSummary, ServerSummary } from '@/shared/types/protocol';
import { initialRoomState } from '@/state/roomReducer';
import { PERMISSIONS } from '@/features/servers/permissionBits';

vi.mock('@/features/friends/ProfileActions', () => ({ ProfileActions: () => null }));

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchUserProfile: vi.fn(),
}));

vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  fetchAllServerMembers: vi.fn(),
  setMemberRoles: vi.fn(),
}));
const mocked = vi.mocked(serversApi);
const mockedApi = vi.mocked(api);

const role = (id: string, over: Partial<RoleSummary> = {}): RoleSummary => ({
  id, name: id, color: '', position: 1, permissions: 0, hoist: false, mentionable: false, isDefault: false, ...over,
});
const server: ServerSummary = {
  id: 's1', name: 'Squad', icon: '', ownerId: 'u-ana', status: 'active', createdAt: 0, memberCount: 3, position: 0,
  permissions: 0, myRoleIds: [], categories: [], channels: [],
  roles: [role('everyone', { isDefault: true, position: 0 }), role('Mods', { hoist: true, position: 2 }), role('Quiet', { position: 3 })],
};
const member = (id: string, name: string, roleIds: string[] = []): ServerMemberEntry => ({
  user: { id, username: id, displayName: name, avatar: '', avatarColor: '' }, roleIds, isOwner: id === 'u-ana', at: '',
});
const members = [member('u-ana', 'Ana', ['Mods']), member('u-bia', 'Bia', ['Quiet']), member('u-caio', 'Caio', ['Mods'])];

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAllServerMembers.mockResolvedValue(members);
  mockedApi.fetchUserProfile.mockRejectedValue(new Error('not stubbed'));
});

describe('groupMembers', () => {
  it('online members go under their hoisted role, everyone offline at the bottom', () => {
    const sections = groupMembers(server, members, new Set(['u-ana', 'u-bia']), { online: 'Online', offline: 'Offline' });
    expect(sections.map((s) => [s.label, s.members.map((m) => m.user.displayName)])).toEqual([
      ['Mods', ['Ana']],
      ['Online', ['Bia']],
      ['Offline', ['Caio']],
    ]);
  });
});

describe('MemberListPanel', () => {
  it('lists the sections with their counts and marks the owner', async () => {
    renderWithRoom(<MemberListPanel server={server} onOpenProfile={vi.fn()} />, { onlineUserIds: new Set(['u-ana', 'u-bia']) });
    expect(await screen.findByText('Mods — 1')).toBeInTheDocument();
    expect(screen.getByText('Disponível — 1')).toBeInTheDocument();
    expect(screen.getByText('Offline — 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Dono do servidor')).toBeInTheDocument();
  });

  it('counts the viewer as online even though the presence snapshot never lists them', async () => {
    renderWithRoom(<MemberListPanel server={server} onOpenProfile={vi.fn()} />, {
      onlineUserIds: new Set(['u-bia']),
      state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u-ana' } },
    });
    expect(await screen.findByText('Mods — 1')).toBeInTheDocument();
    expect(screen.getByText('Offline — 1')).toBeInTheDocument();
  });

  it('opens a compact member profile and lets role managers assign roles there', async () => {
    const user = userEvent.setup();
    mocked.setMemberRoles.mockResolvedValue(undefined);
    renderWithRoom(<MemberListPanel server={{ ...server, permissions: PERMISSIONS.MANAGE_ROLES }} onOpenProfile={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Abrir perfil de Bia' }));
    expect(screen.getByText('@u-bia')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Adicionar cargo' }));
    await user.click(await screen.findByText('Mods', { exact: true }));
    expect(mocked.setMemberRoles).toHaveBeenCalledWith('s1', 'u-bia', ['Quiet', 'Mods']);
  });

  it('shows the member banner image in the compact profile', async () => {
    const user = userEvent.setup();
    mockedApi.fetchUserProfile.mockResolvedValue({ user: { ...member('u-bia', 'Bia').user, banner: 'https://cdn.test/bia.png', bio: '', profileLinks: [], role: 'user' } });
    const { container } = renderWithRoom(<MemberListPanel server={server} onOpenProfile={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: 'Abrir perfil de Bia' }));
    await waitFor(() => expect(container.ownerDocument.querySelector('[style*="https://cdn.test/bia.png"]')).not.toBeNull());
    expect(mockedApi.fetchUserProfile).toHaveBeenCalledWith('u-bia');
  });

  it('opens the full profile from the button at the top of the compact profile', async () => {
    const user = userEvent.setup();
    mockedApi.fetchUserProfile.mockRejectedValue(new Error('offline'));
    const onOpenProfile = vi.fn();
    renderWithRoom(<MemberListPanel server={server} onOpenProfile={onOpenProfile} />);
    await user.click(await screen.findByRole('button', { name: 'Abrir perfil de Bia' }));
    await user.click(screen.getByRole('button', { name: 'Ver perfil completo' }));
    expect(onOpenProfile).toHaveBeenCalledWith('u-bia');
  });

  it('fetches nothing while kept mounted behind a closed sheet', () => {
    renderWithRoom(<MemberListPanel server={server} onOpenProfile={vi.fn()} active={false} />);
    expect(mocked.fetchAllServerMembers).not.toHaveBeenCalled();
  });
});

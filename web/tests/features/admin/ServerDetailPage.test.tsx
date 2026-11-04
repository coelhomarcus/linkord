import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api/api';
import { renderAdmin } from './adminFixture';
import { ServerDetailPage } from '@/features/admin/ServerDetailPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const member = (id: string, role: 'owner' | 'member'): adminApi.AdminServerMember => ({
  user: { id, username: id, displayName: id.toUpperCase(), avatar: '', avatarColor: 'green' }, roleIds: [], isOwner: role === 'owner', at: '2026-01-01T00:00:00.000Z',
});
const detail = (over: Partial<adminApi.AdminServerDetail['server']> = {}, owner = true): adminApi.AdminServerDetail => ({
  server: { id: 'g1', name: 'Squad', icon: '', status: 'active', memberCount: 2, channelCount: 2, ownerId: owner ? 'ana' : null, ownerUsername: owner ? 'ana' : null, createdAt: '2026-01-01T00:00:00.000Z', lastMessageAt: null, statusReason: '', ...over },
  channels: [{ id: 'c1', type: 'text', name: 'geral' }, { id: 'c2', type: 'voice', name: 'Geral' }],
  members: { items: owner ? [member('ana', 'owner'), member('bia', 'member')] : [member('bia', 'member')], nextCursor: null },
  history: [],
});
const open = (tab = '') => renderAdmin(<ServerDetailPage />, { path: `/admin/servers/g1${tab ? `?tab=${tab}` : ''}`, pattern: '/admin/servers/:id' });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminServer.mockResolvedValue(detail());
  mocked.fetchAudit.mockResolvedValue({ items: [], nextCursor: null });
});

describe('ServerDetailPage', () => {
  it('suspending asks for a reason and calls the server API', async () => {
    const u = userEvent.setup();
    mocked.suspendServer.mockResolvedValue({ ok: true });
    open('moderation');
    await u.click(await screen.findByRole('button', { name: 'Suspender servidor' }));
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed report');
    await u.click(screen.getAllByRole('button', { name: 'Suspender' }).at(-1)!);
    await waitFor(() => expect(mocked.suspendServer).toHaveBeenCalledWith('g1', 'confirmed report'));
  });

  it('server with no owner: admin assigns one to a member, with a reason', async () => {
    const u = userEvent.setup();
    mocked.fetchAdminServer.mockResolvedValue(detail({}, false));
    mocked.assignServerOwner.mockResolvedValue({ ok: true });
    open('members');
    expect(await screen.findByRole('button', { name: 'Atribuir dono' })).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Atribuir dono' }));
    await u.type(screen.getByLabelText(/Motivo/), 'recovery');
    await u.click(screen.getByRole('button', { name: 'Atribuir' }));
    await waitFor(() => expect(mocked.assignServerOwner).toHaveBeenCalledWith('g1', 'bia', 'recovery'));
  });

  it('suspended server offers Reactivate and shows the reason', async () => {
    mocked.fetchAdminServer.mockResolvedValue(detail({ status: 'suspended', statusReason: 'conteúdo ilegal' }));
    open('moderation');
    expect(await screen.findByRole('button', { name: 'Reativar servidor' })).toBeInTheDocument();
    expect(screen.getAllByText(/conteúdo ilegal/).length).toBeGreaterThan(0);
  });

  it('deleting requires the server name to be typed in', async () => {
    const u = userEvent.setup();
    mocked.deleteServer.mockResolvedValue({ ok: true });
    open('moderation');
    await u.click(await screen.findByRole('button', { name: 'Excluir servidor' }));
    await u.type(screen.getByLabelText(/Motivo/), 'illegal');
    expect(screen.getByRole('button', { name: 'Excluir para sempre' })).toBeDisabled();
    await u.type(screen.getByLabelText(/Para confirmar/), 'Squad');
    await u.click(screen.getByRole('button', { name: 'Excluir para sempre' }));
    await waitFor(() => expect(mocked.deleteServer).toHaveBeenCalledWith('g1', 'illegal'));
  });

  it('the owner dialog names the current and the new owner, and nothing changes until the server confirms', async () => {
    const u = userEvent.setup();
    let confirm!: () => void;
    mocked.assignServerOwner.mockImplementation(() => new Promise((resolve) => { confirm = () => resolve({ ok: true }); }));
    open('members');
    await u.click(await screen.findByRole('button', { name: 'Atribuir dono' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Dono atual: @ana. Novo dono: @bia.');
    await u.type(screen.getByLabelText(/Motivo/), 'owner left the platform');
    await u.click(screen.getByRole('button', { name: 'Atribuir' }));
    expect(mocked.fetchAdminServer).toHaveBeenCalledTimes(1);
    confirm();
    await waitFor(() => expect(mocked.fetchAdminServer).toHaveBeenCalledTimes(2));
  });

  it('a member who left while the dialog was open: explains, and refreshes the members', async () => {
    const u = userEvent.setup();
    mocked.assignServerOwner.mockRejectedValue(new ApiError(409, 'not_member', 'x'));
    open('members');
    await u.click(await screen.findByRole('button', { name: 'Atribuir dono' }));
    await u.type(screen.getByLabelText(/Motivo/), 'recovery');
    mocked.fetchAdminServer.mockResolvedValue({ ...detail(), members: { items: [member('ana', 'owner')], nextCursor: null } });
    await u.click(screen.getByRole('button', { name: 'Atribuir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não é mais membro do servidor');
    await waitFor(() => expect(mocked.fetchAdminServer).toHaveBeenCalledTimes(2));
  });

  it('suspending a server that was already suspended explains the conflict and catches the screen up', async () => {
    const u = userEvent.setup();
    mocked.suspendServer.mockRejectedValue(new ApiError(409, 'already_suspended', 'x'));
    open('moderation');
    await u.click(await screen.findByRole('button', { name: 'Suspender servidor' }));
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed report');
    mocked.fetchAdminServer.mockResolvedValue(detail({ status: 'suspended', statusReason: 'outro admin' }));
    await u.click(screen.getAllByRole('button', { name: 'Suspender' }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Já estava suspenso');
    await waitFor(() => expect(mocked.fetchAdminServer).toHaveBeenCalledTimes(2));
  });

  it('lists the channels by type', async () => {
    open('channels');
    expect(await screen.findByText('geral')).toBeInTheDocument();
    expect(screen.getByText('Texto')).toBeInTheDocument();
    expect(screen.getByText('Voz')).toBeInTheDocument();
  });
});

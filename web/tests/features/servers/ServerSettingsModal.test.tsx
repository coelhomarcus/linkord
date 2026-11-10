import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { initialRoomState } from '@/state/roomReducer';
import { ServerSettingsModal } from '@/features/servers/ServerSettingsModal';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import * as serversApi from '@/features/servers/serversApi';
import { ApiError } from '@/shared/api/api';
import type { RoleSummary, ServerSummary } from '@/shared/types/protocol';

vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  fetchAllServerMembers: vi.fn(), updateRole: vi.fn(), updateServer: vi.fn(),
}));
const mocked = vi.mocked(serversApi);

const everyone: RoleSummary = { id: 'r0', name: '@everyone', color: '', position: 0, permissions: PERMISSIONS.VIEW_CHANNEL, hoist: false, mentionable: false, isDefault: true };
const mods: RoleSummary = { id: 'r1', name: 'Mods', color: '', position: 1, permissions: PERMISSIONS.VIEW_CHANNEL, hoist: false, mentionable: false, isDefault: false };
// the member's own role: MANAGE_ROLES, above Mods
const leads: RoleSummary = { id: 'r2', name: 'Leads', color: '', position: 2, permissions: PERMISSIONS.MANAGE_ROLES, hoist: false, mentionable: false, isDefault: false };
const baseServer = {
  id: 's1', name: 'Squad', icon: '', ownerId: 'someone-else', status: 'active',
  permissions: PERMISSIONS.MANAGE_SERVER | PERMISSIONS.MANAGE_ROLES, roles: [everyone, mods, leads], categories: [], channels: [], myRoleIds: ['r2'],
} as unknown as ServerSummary;

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAllServerMembers.mockResolvedValue([]);
});

async function open(tab: 'Visão geral' | 'Cargos', server: ServerSummary = baseServer) {
  renderWithRoom(<MemoryRouter><ServerSettingsModal server={server} onClose={vi.fn()} onOpenProfile={vi.fn()} /></MemoryRouter>, {
    state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } },
  });
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: tab }));
  return user;
}

const roleBar = () => screen.queryByRole('region', { name: 'Salvar alterações do cargo Mods' });

describe('ServerSettingsModal — roles', () => {
  it('without edits shows no save bar, only the delete button below the form', async () => {
    await open('Cargos');
    expect(roleBar()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Excluir cargo' })).toBeInTheDocument();
  });

  it('an edit shows the standard bar, and Reset puts the role back', async () => {
    const user = await open('Cargos');
    await user.click(screen.getByRole('switch', { name: 'Exibir membros com este cargo separadamente' }));
    const bar = roleBar()!;
    expect(within(bar).getByText('Não se esqueça de salvar suas alterações!')).toBeInTheDocument();
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['Redefinir', 'Salvar']);

    await user.click(within(bar).getByRole('button', { name: 'Redefinir' }));
    expect(roleBar()).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Exibir membros com este cargo separadamente' })).not.toBeChecked();
  });

  it('saves the draft, confirms it, and an edit after that is pending again', async () => {
    mocked.updateRole.mockResolvedValue(undefined as never);
    const user = await open('Cargos');
    await user.click(screen.getByRole('switch', { name: 'Exibir membros com este cargo separadamente' }));
    await user.click(within(roleBar()!).getByRole('button', { name: 'Salvar' }));
    expect(mocked.updateRole).toHaveBeenCalledWith('r1', expect.objectContaining({ name: 'Mods', hoist: true }));
    // the saved role has not come back from the server yet, and still the bar confirms the save
    expect(await within(roleBar()!).findByRole('status')).toHaveTextContent('Alterações salvas.');

    await user.type(screen.getByLabelText('Nome do cargo'), '!');
    expect(within(roleBar()!).getByRole('button', { name: 'Salvar' })).toBeEnabled();
  });

  it('a failed save shows the reason in the bar and keeps the edits', async () => {
    mocked.updateRole.mockRejectedValue(new ApiError(403, 'some_new_code', 'Sem permissão.'));
    const user = await open('Cargos');
    await user.click(screen.getByRole('switch', { name: 'Exibir membros com este cargo separadamente' }));
    await user.click(within(roleBar()!).getByRole('button', { name: 'Salvar' }));
    expect(await within(roleBar()!).findByRole('alert')).toHaveTextContent('Sem permissão.');
    expect(within(roleBar()!).getByRole('button', { name: 'Salvar' })).toBeEnabled();
    expect(screen.getByRole('switch', { name: 'Exibir membros com este cargo separadamente' })).toBeChecked();
  });

  it('lets anyone mention the role once the switch is on', async () => {
    mocked.updateRole.mockResolvedValue(undefined as never);
    const user = await open('Cargos');
    const mentionable = screen.getByRole('switch', { name: /^Permitir que qualquer pessoa mencione este cargo/ });
    expect(mentionable).not.toBeChecked();
    await user.click(mentionable);
    await user.click(within(roleBar()!).getByRole('button', { name: 'Salvar' }));
    expect(mocked.updateRole).toHaveBeenCalledWith('r1', expect.objectContaining({ mentionable: true }));
  });

  it('lists the mention permission among the text ones', async () => {
    await open('Cargos');
    expect(screen.getByRole('switch', { name: /^Mencionar @everyone, @here e todos os cargos/ })).toBeInTheDocument();
  });

  it('leaves the permissions the member does not hold off-limits', async () => {
    await open('Cargos');
    expect(screen.getByRole('switch', { name: /^Banir membros/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('switch', { name: /^Gerenciar cargos/ })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('a role at or above the member\'s own opens read-only, without delete', async () => {
    const user = await open('Cargos');
    await user.click(screen.getByRole('button', { name: /^Leads/ }));
    expect(screen.getByRole('note')).toHaveTextContent('no seu nível ou acima');
    expect(screen.getByLabelText('Nome do cargo')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Excluir cargo' })).not.toBeInTheDocument();
    // Mods sits right under Leads: moving it up would put it at the member's own level
    expect(screen.getAllByRole('button', { name: 'Subir' })[1]).toBeDisabled();
  });

  it('@everyone says it applies to everyone at once', async () => {
    const user = await open('Cargos');
    await user.click(screen.getByRole('button', { name: /^@everyone/ }));
    expect(screen.getByRole('note')).toHaveTextContent('vale para todos os membros');
  });

  it('granting Administrator asks first', async () => {
    const user = await open('Cargos', { ...baseServer, permissions: PERMISSIONS.ADMINISTRATOR | PERMISSIONS.MANAGE_ROLES });
    const toggle = screen.getByRole('switch', { name: /^Administrador/ });
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await user.click(within(await screen.findByRole('dialog', { name: 'Dar Administrador?' })).getByRole('button', { name: 'Dar Administrador' }));
    expect(screen.getByRole('switch', { name: /^Administrador/ })).toBeChecked();
  });

  it('an emptied name cannot be saved', async () => {
    const user = await open('Cargos');
    await user.clear(screen.getByLabelText('Nome do cargo'));
    expect(within(roleBar()!).getByRole('button', { name: 'Salvar' })).toBeDisabled();
  });
});

describe('ServerSettingsModal — overview', () => {
  it('renaming the server goes through the standard bar', async () => {
    mocked.updateServer.mockResolvedValue(undefined as never);
    const user = await open('Visão geral');
    expect(screen.queryByRole('region', { name: 'Salvar alterações do servidor' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Nome do servidor'), '!');
    const bar = screen.getByRole('region', { name: 'Salvar alterações do servidor' });
    expect(within(bar).getAllByRole('button').map((button) => button.textContent)).toEqual(['Redefinir', 'Salvar']);
    await user.click(within(bar).getByRole('button', { name: 'Salvar' }));
    expect(mocked.updateServer).toHaveBeenCalledWith('s1', { name: 'Squad!' });
  });
});

import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from '@/app/AdminApp';
import * as adminApi from '@/features/admin/adminApi';
import { reportAdminAccessLost, reportAdminSessionEnded } from '@/features/admin/adminAccess';
import { fetchAdminSession } from '@/features/admin/adminSessionApi';
import { useAdminLayout } from '@/features/admin/useAdminLayout';
import { ApiError } from '@/shared/api/transport';

vi.mock('@/features/admin/adminApi');
vi.mock('@/features/admin/adminSessionApi');
vi.mock('@/features/admin/useAdminLayout');

const session = vi.mocked(fetchAdminSession);
const layout = vi.mocked(useAdminLayout);
const api = vi.mocked(adminApi);

function open(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><AdminApp /></MemoryRouter>);
}

beforeEach(() => {
  vi.resetAllMocks();
  session.mockResolvedValue({ user: { id: 'admin-1', username: 'ana', locale: 'pt-BR' } });
  layout.mockReturnValue('wide');
  api.fetchSystem.mockResolvedValue({
    startedAt: '2026-01-01T00:00:00.000Z',
    storage: { usedBytes: 512, maxBytes: 1024, files: 1 },
    connections: { onlineAccounts: 2, live: 3, max: 100, perAccountMax: 4, perIpMax: 20 },
    accounts: { total: 23, suspended: 1, activeAdmins: 2, newLastHour: 1, newPerHourCap: 0 },
    livekit: { configured: true },
    outbox: { pending: 1, failed: 0 },
    notifications: { unread: 0 },
    retention: { targets: [], last: null },
    orphanSweep: { dryRunByDefault: true, last: null },
  });
  api.fetchCallMetrics.mockResolvedValue({
    current: { calls: 0, accountsInCall: 0, onlineAccounts: 2, at: '2026-01-01T00:00:00.000Z', screens: null },
    timeZone: 'America/Belem',
    history: [],
  });
  api.fetchAudit.mockResolvedValue({ items: [], nextCursor: null });
  api.fetchAdminReports.mockResolvedValue({ items: [], nextCursor: null });
  api.fetchAdminUsers.mockResolvedValue({ items: [], nextCursor: null });
  api.fetchAdminUser.mockReturnValue(new Promise(() => {}));
});

describe('admin app', () => {
  it('requires an administrative session before loading a list', async () => {
    session.mockRejectedValue(new ApiError(401, 'unauthenticated', 'No session'));
    open('/admin/users');
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(api.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it('keeps the overview on compact screens and opens its navigation on demand', async () => {
    layout.mockReturnValue('compact');
    open('/admin');
    expect(await screen.findByRole('heading', { name: 'Visão geral' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: /Total de contas 23/ })).toHaveAttribute('href', '/admin/users');
    expect(await screen.findByRole('link', { name: 'Ver histórico' })).toHaveAttribute('href', '/admin/call-metrics');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Abrir navegação' }));
    const dialog = screen.getByRole('dialog', { name: 'Administração' });
    await user.click(within(dialog).getByRole('link', { name: 'Usuários' }));
    expect(await screen.findByRole('heading', { name: 'Usuários' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps separate overview panels usable when instance metrics fail, and retries them', async () => {
    api.fetchSystem.mockRejectedValueOnce(new Error('Unavailable'));
    open('/admin');
    expect(await screen.findByText('Não foi possível carregar as métricas da instância.')).toBeInTheDocument();
    expect(await screen.findByText('Nenhuma denúncia aberta.')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('link', { name: /Total de contas 23/ })).toBeInTheDocument();
    expect(api.fetchSystem).toHaveBeenCalledTimes(2);
  });

  it('keeps a direct link to a user detail in compact mode', async () => {
    layout.mockReturnValue('compact');
    open('/admin/users/u1');
    await screen.findByRole('button', { name: 'Sair' });
    await waitFor(() => expect(api.fetchAdminUser).toHaveBeenCalledWith('u1'));
    expect(api.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it.each([
    [reportAdminAccessLost, 'Você não tem mais acesso à administração'],
    [reportAdminSessionEnded, 'Sua sessão terminou'],
  ] as const)('clears administrative data when a session can no longer act', async (report, notice) => {
    open('/admin/users');
    expect(await screen.findByText('Nenhuma conta ainda')).toBeInTheDocument();
    act(report);
    expect(screen.getByRole('alert')).toHaveTextContent(notice);
    expect(screen.queryByText('Nenhuma conta ainda')).not.toBeInTheDocument();
  });
});

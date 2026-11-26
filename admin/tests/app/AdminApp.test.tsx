import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminApp } from '@/app/AdminApp';
import * as adminApi from '@/features/admin/adminApi';
import { reportAdminAccessLost, reportAdminSessionEnded } from '@/features/admin/adminAccess';
import { fetchAdminSession } from '@/features/admin/adminSessionApi';
import { useAdminLayout } from '@/features/admin/useAdminLayout';
import { ApiError } from '@linkord/frontend-shared/api/transport';

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
  layout.mockReturnValue({ mode: 'wide', measured: true });
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

  it('shows the section index at the compact entry', async () => {
    layout.mockReturnValue({ mode: 'compact', measured: true });
    open('/admin');
    expect(await screen.findByRole('heading', { name: 'Administração' })).toBeInTheDocument();
    expect(api.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it('keeps a direct link to a user detail in compact mode', async () => {
    layout.mockReturnValue({ mode: 'compact', measured: true });
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

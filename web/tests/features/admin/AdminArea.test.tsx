import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { reportAdminAccessLost, reportAdminSessionEnded } from '@/features/admin/adminAccess';
import { renderAdmin, adminRoom } from './adminFixture';
import AdminArea from '@/features/admin/AdminArea';
import * as adminApi from '@/features/admin/adminApi';
import { useAdminLayout } from '@/features/admin/useAdminLayout';

vi.mock('@/shared/PageHeader', () => ({
  PageHeader: ({ title, subtitle, leading }: { title: string; subtitle?: string; leading?: React.ReactNode }) => (
    <header>{leading}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</header>
  ),
}));
vi.mock('@/features/admin/adminApi');
const refreshAuth = vi.fn().mockResolvedValue(undefined);
vi.mock('@/state/AuthContext', () => ({ useAuth: () => ({ refresh: refreshAuth }) }));
vi.mock('@/features/admin/useAdminLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/admin/useAdminLayout')>()),
  useAdminLayout: vi.fn(() => ({ mode: 'wide', measured: true })),
}));
const mocked = vi.mocked(adminApi);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAdminLayout).mockReturnValue({ mode: 'wide', measured: true });
  mocked.fetchAdminUsers.mockResolvedValue({ items: [], nextCursor: null });
  mocked.fetchAdminUser.mockReturnValue(new Promise(() => {}));
  mocked.fetchAdminReport.mockReturnValue(new Promise(() => {}));
});

describe('AdminArea', () => {
  it('a non-admin is redirected back to conversations (the UI only hides; the server decides)', () => {
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*', room: adminRoom('user') });
    expect(screen.getByText('outra rota')).toBeInTheDocument();
    expect(mocked.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it('the bare /admin entry in compact mode is the section index, and does not fetch a list', () => {
    vi.mocked(useAdminLayout).mockReturnValue({ mode: 'compact', measured: true });
    renderAdmin(<AdminArea />, { path: '/admin', pattern: '/admin/*' });
    expect(screen.getByRole('heading', { name: 'Administração' })).toBeInTheDocument();
    expect(mocked.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it('a detail URL is never redirected because of the window size', () => {
    vi.mocked(useAdminLayout).mockReturnValue({ mode: 'compact', measured: true });
    renderAdmin(<AdminArea />, { path: '/admin/users/u1', pattern: '/admin/*' });
    expect(mocked.fetchAdminUser).toHaveBeenCalled();
    expect(mocked.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it('losing admin access replaces the pages with an explanation, then leaves for the conversations', async () => {
    const u = userEvent.setup();
    const dispatch = vi.fn();
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*', room: { ...adminRoom(), dispatch } });
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();

    act(() => reportAdminAccessLost());
    expect(screen.getByRole('alert')).toHaveTextContent('Você não tem mais acesso à administração');
    expect(screen.queryByText('Nenhuma conta encontrada.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Grupos' })).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Voltar às conversas' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ROLE', role: 'user' });
    expect(screen.getByText('outra rota')).toBeInTheDocument();
  });

  it('a request answered 401 replaces the pages with "session ended" and re-reads the auth state', async () => {
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*' });
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();

    act(() => reportAdminSessionEnded());
    expect(screen.getByRole('alert')).toHaveTextContent('Sua sessão terminou');
    expect(screen.queryByText('Nenhuma conta encontrada.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Grupos' })).not.toBeInTheDocument();
    expect(refreshAuth).toHaveBeenCalledTimes(1);
  });
});

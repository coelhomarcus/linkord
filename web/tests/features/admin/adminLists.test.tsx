import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { adminRoom, renderAdmin } from './adminFixture';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { UsersPage } from '@/features/admin/UsersPage';
import { UserDetailPage } from '@/features/admin/UserDetailPage';
import { AuditPage } from '@/features/admin/AuditPage';
import * as adminApi from '@/features/admin/adminApi';
import { invalidateAdminLists } from '@/features/admin/adminListCache';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const user = (over: Partial<adminApi.AdminUserRow> = {}): adminApi.AdminUserRow => ({
  id: 'u1', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple', role: 'user', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: null, online: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAdminLists();
  mocked.fetchAdminUsers.mockResolvedValue({ items: [user()], nextCursor: null });
  mocked.fetchAdminUser.mockResolvedValue({
    user: { ...user(), email: 'ana@example.com', statusReason: '', statusChangedAt: null },
    groups: [], storage: { bytes: 0, files: 0 }, history: [],
  });
});

describe('filters live in the URL', () => {
  it('an unknown filter value in the URL is ignored instead of breaking the list', async () => {
    renderAdmin(<UsersPage />, { path: '/admin/users?status=banana', pattern: '/admin/users' });
    await screen.findByText('Ana');
    expect(mocked.fetchAdminUsers).toHaveBeenCalledWith({ q: '', status: undefined, role: undefined }, null);
  });

  it('a search containing a pipe reaches the server intact (no joined-string identity)', async () => {
    const u = userEvent.setup();
    mocked.fetchAudit.mockResolvedValue({ items: [], nextCursor: null });
    renderAdmin(<AuditPage />, { path: '/admin/audit', pattern: '/admin/audit' });
    await screen.findByText('Nenhum registro para esses filtros.');
    await u.type(screen.getByLabelText('Administrador'), 'a|b');
    await waitFor(() => expect(mocked.fetchAudit).toHaveBeenLastCalledWith(expect.objectContaining({ actor: 'a|b', action: '', targetId: '' }), null));
  });
});

describe('back from a detail', () => {
  function app(initial: string) {
    return renderWithRoom(
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/users/:id" element={<UserDetailPage />} />
        </Routes>
      </MemoryRouter>,
      adminRoom(),
    );
  }

  it('returns to the exact query the admin came from', async () => {
    const u = userEvent.setup();
    app('/admin/users?status=suspended&q=ana');
    await u.click(await screen.findByRole('link', { name: /Ana.*@ana/ }));
    expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Usuários' })).toHaveAttribute('data-to', '/admin/users?status=suspended&q=ana');
  });

  it('a direct access falls back to the plain list', async () => {
    renderWithRoom(
      <MemoryRouter initialEntries={[{ pathname: '/admin/users/u1', state: { from: 'https://evil.example/x' } }]}>
        <Routes><Route path="/admin/users/:id" element={<UserDetailPage />} /></Routes>
      </MemoryRouter>,
      adminRoom(),
    );
    expect(await screen.findByRole('link', { name: '← Usuários' })).toHaveAttribute('data-to', '/admin/users');
  });
});

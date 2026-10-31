import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderAdmin } from './adminFixture';
import { UsersPage } from '@/features/admin/UsersPage';
import { GroupsPage } from '@/features/admin/GroupsPage';
import { dayStartIso, nextDayStartIso } from '@/features/admin/adminFormat';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const user = (over: Partial<adminApi.AdminUserRow> = {}): adminApi.AdminUserRow => ({
  id: 'u1', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple', role: 'user', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', lastSeenAt: null, online: false, ...over,
});
const group = (over: Partial<adminApi.AdminGroupRow> = {}): adminApi.AdminGroupRow => ({
  id: 'g1', title: 'Squad', avatar: '', status: 'active', memberCount: 3, ownerId: 'u1', ownerUsername: 'ana', createdBy: 'u1', createdAt: '2026-01-01T00:00:00.000Z', lastMessageAt: null, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminUsers.mockResolvedValue({ items: [user()], nextCursor: null });
  mocked.fetchAdminGroups.mockResolvedValue({ items: [group()], nextCursor: null });
});

describe('list filters reach the server', () => {
  it('the period keeps "up to" inclusive: the server gets the start of the NEXT day', async () => {
    renderAdmin(<UsersPage />, { path: '/admin/users?from=2026-03-01&to=2026-03-31', pattern: '/admin/users' });
    await screen.findByText('Ana');
    expect(mocked.fetchAdminUsers).toHaveBeenCalledWith(expect.objectContaining({
      from: new Date(2026, 2, 1).toISOString(),
      to: new Date(2026, 3, 1).toISOString(),
    }), null);
  });

  it('the "no owner" filter reaches the server as the orphan flag', async () => {
    renderAdmin(<GroupsPage />, { path: '/admin/groups?filter=orphan', pattern: '/admin/groups' });
    await screen.findByText('Squad');
    expect(mocked.fetchAdminGroups).toHaveBeenCalledWith({ q: '', status: undefined, orphan: true }, null);
  });
});

describe('day helpers', () => {
  it('reject anything that is not a plain date', () => {
    expect(dayStartIso('2026-13-45')).toBeUndefined();
    expect(dayStartIso('2026-02-31')).toBeUndefined();
    expect(dayStartIso('garbage')).toBeUndefined();
    expect(nextDayStartIso('2026-12-31')).toBe(new Date(2027, 0, 1).toISOString());
    expect(nextDayStartIso('')).toBeUndefined();
  });
});

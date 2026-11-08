import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';
import { ServerAuditLog } from '@/features/servers/ServerAuditLog';
import { PERMISSIONS } from '@/features/servers/permissionBits';
import * as serversApi from '@/features/servers/serversApi';
import type { ServerAuditEntry } from '@/features/servers/serversApi';
import type { ServerSummary } from '@/shared/types/protocol';

vi.mock('@/features/servers/serversApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/servers/serversApi')>()),
  fetchServerAuditLog: vi.fn(), fetchAllServerMembers: vi.fn(),
}));
const mocked = vi.mocked(serversApi);

const server = { id: 's1', name: 'Squad', icon: '', ownerId: 'me', status: 'active', permissions: PERMISSIONS.VIEW_AUDIT_LOG, roles: [], categories: [], channels: [], myRoleIds: [] } as unknown as ServerSummary;
const alice = { id: 'u1', username: 'alice', displayName: 'Alice', avatar: '', avatarColor: 'blurple' };
const bob = { id: 'u2', username: 'bob', displayName: 'Bob', avatar: '', avatarColor: 'blurple' };

const entry = (over: Partial<ServerAuditEntry>): ServerAuditEntry => ({
  id: 'e1', at: '2026-11-08T12:00:00.000000Z', action: 'member.kick',
  actorId: alice.id, actorLabel: 'alice', actor: alice,
  targetType: 'user', targetId: bob.id, targetLabel: 'bob', targetUser: bob,
  reason: '', detail: {}, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAllServerMembers.mockResolvedValue([{ user: alice, roleIds: [], isOwner: true, at: '' }, { user: bob, roleIds: [], isOwner: false, at: '' }]);
});

describe('ServerAuditLog', () => {
  it('tells who did what to whom, and shows the before and after of a change', async () => {
    mocked.fetchServerAuditLog.mockResolvedValue({ items: [
      entry({ id: 'e1' }),
      entry({ id: 'e2', action: 'role.update', targetType: 'role', targetId: 'r1', targetLabel: 'Mod', targetUser: null,
        detail: { changes: [{ key: 'name', before: 'Helper', after: 'Mod' }, { key: 'permissions', before: PERMISSIONS.KICK_MEMBERS, after: PERMISSIONS.BAN_MEMBERS }] } }),
    ], nextCursor: null });
    renderWithRoom(<ServerAuditLog server={server} />);
    const list = await screen.findByRole('list', { name: 'Registro de auditoria' });
    const [kick, update] = within(list).getAllByRole('listitem');
    expect(kick).toHaveTextContent('Alice expulsou Bob');
    expect(update).toHaveTextContent('Alice atualizou o cargo Mod');

    await userEvent.click(within(update!).getByRole('button', { name: 'Detalhes' }));
    expect(update).toHaveTextContent('Helper');
    expect(update).toHaveTextContent('+ Banir membros');
    expect(update).toHaveTextContent('− Expulsar membros');
  });

  it('clicking a name filters by that person, and more pages load on demand', async () => {
    mocked.fetchServerAuditLog.mockResolvedValueOnce({ items: [entry({ id: 'e1' })], nextCursor: 'next' });
    renderWithRoom(<ServerAuditLog server={server} />);
    const list = await screen.findByRole('list', { name: 'Registro de auditoria' });

    mocked.fetchServerAuditLog.mockResolvedValueOnce({ items: [entry({ id: 'e2', action: 'member.ban', reason: 'spam' })], nextCursor: null });
    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(mocked.fetchServerAuditLog).toHaveBeenLastCalledWith('s1', expect.any(Object), 'next');
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2));

    mocked.fetchServerAuditLog.mockResolvedValue({ items: [], nextCursor: null });
    await userEvent.click(within(list).getAllByRole('button', { name: 'Bob' })[0]!);
    await waitFor(() => expect(mocked.fetchServerAuditLog.mock.lastCall?.[1]).toMatchObject({ target: bob.id }));
    expect(await screen.findByText('Nenhum registro com esses filtros')).toBeInTheDocument();
    // the filter bar's button and the empty state's do the same thing
    const clearButtons = screen.getAllByRole('button', { name: 'Limpar filtros' });
    expect(clearButtons).toHaveLength(2);
    await userEvent.click(clearButtons.at(-1)!);
    await waitFor(() => expect(mocked.fetchServerAuditLog.mock.lastCall?.[1]).not.toHaveProperty('target'));
  });

  it('keeps naming an account that is gone', async () => {
    mocked.fetchServerAuditLog.mockResolvedValue({ items: [entry({ actor: null, actorLabel: 'olduser' })], nextCursor: null });
    renderWithRoom(<ServerAuditLog server={server} />);
    expect(await screen.findByRole('listitem')).toHaveTextContent('olduser expulsou Bob');
  });

  describe('in English', () => {
    useLanguageForTests('en-US');
    it('reads in the viewer language', async () => {
      mocked.fetchServerAuditLog.mockResolvedValue({ items: [entry({})], nextCursor: null });
      renderWithRoom(<ServerAuditLog server={server} />);
      expect(await screen.findByRole('listitem')).toHaveTextContent('Alice kicked Bob');
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { auditRow, chooseAdminSelect, renderAdmin } from './adminFixture';
import { AuditPage } from '@/features/admin/AuditPage';
import { useAdminTableFits } from '@/features/admin/useAdminMode';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
vi.mock('@/features/admin/useAdminMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/admin/useAdminMode')>()),
  useAdminTableFits: vi.fn(() => true),
}));
const mocked = vi.mocked(adminApi);

const open = (path = '/admin/audit') => renderAdmin(<AuditPage />, { path, pattern: '/admin/audit' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAdminTableFits).mockReturnValue(true);
  mocked.fetchAudit.mockResolvedValue({ items: [auditRow(), auditRow({ id: 'a2', action: 'user.delete', result: 'failed', targetId: 'u2', targetLabel: 'bia' })], nextCursor: null });
});

describe('AuditPage', () => {
  it('the action filter lists readable labels; choosing one sends the technical code', async () => {
    const u = userEvent.setup();
    open();
    await screen.findByRole('table');
    await chooseAdminSelect(u, 'Ação', 'Conta suspensa');
    await waitFor(() => expect(mocked.fetchAudit).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'user.suspend' }), null));
  });

  it('an action code the labels do not know is kept from the URL, not reset', async () => {
    open('/admin/audit?action=custom.thing');
    await screen.findByRole('table');
    expect(screen.getByRole('combobox', { name: 'Ação' })).toHaveTextContent('custom.thing (código desconhecido)');
    expect(mocked.fetchAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'custom.thing' }), null);
  });

  it('administrator, target type and target id filters reach the server and show as active', async () => {
    const u = userEvent.setup();
    open();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument();
    await chooseAdminSelect(u, 'Tipo de alvo', 'Grupo');
    await u.type(screen.getByLabelText('Administrador'), 'lune');
    await u.type(screen.getByLabelText('ID do alvo'), 'g1');
    await waitFor(() => expect(mocked.fetchAudit).toHaveBeenLastCalledWith(expect.objectContaining({ targetType: 'group', actor: 'lune', targetId: 'g1' }), null));
    expect(screen.getByRole('button', { name: 'Limpar filtros' })).toBeInTheDocument();
  });

  it('the period end includes the whole last day, and the time zone used is shown', async () => {
    open('/admin/audit?from=2026-03-01&to=2026-03-31');
    await screen.findByText('Conta suspensa');
    expect(mocked.fetchAudit).toHaveBeenCalledWith(expect.objectContaining({
      from: new Date(2026, 2, 1).toISOString(),
      to: new Date(2026, 3, 1).toISOString(),
    }), null);
    expect(screen.getByText(/Dias no fuso/)).toBeInTheDocument();
    expect(screen.getByLabelText('Até (inclusive)')).toHaveValue('2026-03-31');
  });

  it('is read-only: there is no edit or delete control', async () => {
    open();
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: /apagar|editar|excluir/i })).not.toBeInTheDocument();
  });
});

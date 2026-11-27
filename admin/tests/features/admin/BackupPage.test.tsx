import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderAdmin } from './adminFixture';
import { ApiError } from '@/shared/api/transport';
import { BackupPage } from '@/features/admin/BackupPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const row = (over: Partial<adminApi.AuditRow> = {}): adminApi.AuditRow => ({
  id: crypto.randomUUID(), at: '2026-11-20T10:00:00.000Z', actorId: 'u1', actorLabel: 'marina', action: 'system.backup_download',
  targetType: 'system', targetId: '', targetLabel: '', reason: 'monthly copy', result: 'ok', detail: {}, requestId: 'req-1', ...over,
});
const info = (over: Partial<adminApi.BackupInfo> = {}): adminApi.BackupInfo => ({
  available: true, running: null,
  estimate: { databaseBytes: 40 * 1024 * 1024, uploadsBytes: 2 * 1024 * 1024 * 1024, files: 1234 },
  recent: [], ...over,
});
const open = () => renderAdmin(<BackupPage />, { path: '/admin/backup', pattern: '/admin/backup' });

let clicked: string[];
beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchBackupInfo.mockResolvedValue(info());
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(`${this.getAttribute('href')} download=${this.hasAttribute('download')}`);
  });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('BackupPage', () => {
  it('shows what the backup will weigh and what it holds', async () => {
    open();
    expect(await screen.findByText('cerca de 2.0 GB')).toBeInTheDocument();
    expect(screen.getByText('até 40.0 MB')).toBeInTheDocument();
    expect(screen.getByText('1234 arquivos, 2.0 GB')).toBeInTheDocument();
    expect(screen.getByText('database.dump')).toBeInTheDocument();
    expect(screen.getByText(/Não inclui o \.env/)).toBeInTheDocument();
    expect(screen.getByText('Nenhum backup baixado ainda.')).toBeInTheDocument();
  });

  it('asks for a reason, then hands the one-time link to the browser as a download', async () => {
    const u = userEvent.setup();
    mocked.requestBackupDownload.mockResolvedValue({ url: '/api/admin/backup/download/tok', expiresAt: '2026-11-26T10:01:00.000Z' });
    open();
    await u.click(await screen.findByRole('button', { name: 'Baixar backup' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('hashes de senha');
    await u.type(screen.getByLabelText(/Motivo/), 'before upgrade');
    await u.click(screen.getByRole('button', { name: 'Baixar' }));
    await waitFor(() => expect(mocked.requestBackupDownload).toHaveBeenCalledWith('before upgrade'));
    expect(clicked).toEqual(['/api/admin/backup/download/tok download=true']);
    expect(await screen.findByText(/O download começou no seu navegador/)).toBeInTheDocument();
  });

  it('explains a refusal in the dialog and starts nothing', async () => {
    const u = userEvent.setup();
    mocked.requestBackupDownload.mockRejectedValue(new ApiError(409, 'backup_running', 'Outro backup está sendo baixado.'));
    open();
    await u.click(await screen.findByRole('button', { name: 'Baixar backup' }));
    await u.type(screen.getByLabelText(/Motivo/), 'again');
    await u.click(screen.getByRole('button', { name: 'Baixar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Outro backup está sendo baixado. Espere ele terminar.');
    expect(clicked).toEqual([]);
  });

  it('cannot start while another backup runs, or without pg_dump', async () => {
    mocked.fetchBackupInfo.mockResolvedValueOnce(info({ running: { by: 'joao', startedAt: '2026-11-26T09:00:00.000Z' } }));
    const first = open();
    expect(await screen.findByText(/joao está baixando um backup/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar backup' })).toBeDisabled();
    first.unmount();

    mocked.fetchBackupInfo.mockResolvedValueOnce(info({ available: false }));
    open();
    expect(await screen.findByText(/não tem o pg_dump instalado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Baixar backup' })).toBeDisabled();
  });

  it('lists recent downloads, a failed one with its reason, and links to the audit log', async () => {
    mocked.fetchBackupInfo.mockResolvedValue(info({
      recent: [row({ result: 'failed', detail: { error: 'The backup was cancelled.' } }), row({ actorLabel: 'pedro', reason: 'weekly' })],
    }));
    open();
    expect(await screen.findByText('Falhou: The backup was cancelled.')).toBeInTheDocument();
    expect(screen.getByText('pedro')).toBeInTheDocument();
    expect(screen.getByText('weekly')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver na auditoria' })).toHaveAttribute('data-to', '/admin/audit?action=system.backup_download');
  });
});

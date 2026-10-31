import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chooseAdminSelect, renderAdmin } from './adminFixture';
import { ApiError } from '@/shared/api/api';
import { useAdminTableFits } from '@/features/admin/useAdminMode';
import { ReportsPage } from '@/features/admin/ReportsPage';
import { ReportDetailPage } from '@/features/admin/ReportDetailPage';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/features/admin/adminApi');
vi.mock('@/features/admin/useAdminMode', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/admin/useAdminMode')>()),
  useAdminTableFits: vi.fn(() => true),
}));
const mocked = vi.mocked(adminApi);

const row = (over: Partial<adminApi.AdminReportRow> = {}): adminApi.AdminReportRow => ({
  id: 'r1', targetType: 'message', targetId: '9', targetLabel: 'mensagem de bia', category: 'harassment', status: 'open', reporter: 'ana', assignee: null, createdAt: '2026-01-01T00:00:00.000Z', ...over,
});
const detail = (over: Partial<adminApi.AdminReportDetail['report']> = {}): adminApi.AdminReportDetail => ({
  report: { ...row(), details: 'foi ofensivo', snapshot: { text: 'texto da mensagem', authorUsername: 'bia', conversationTitle: 'Squad', sentAt: '2026-01-01T00:00:00.000Z' }, resolution: '', resolutionNote: '', resolvedAt: null, ...over },
  history: [],
});
const openDetail = () => renderAdmin(<ReportDetailPage />, { path: '/admin/reports/r1', pattern: '/admin/reports/:id' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAdminTableFits).mockReturnValue(true);
  mocked.fetchAdminReports.mockResolvedValue({ items: [row()], nextCursor: null });
  mocked.fetchAdminReport.mockResolvedValue(detail());
});

describe('ReportsPage', () => {
  it('the queue and the target type are filters, and both reach the server', async () => {
    const u = userEvent.setup();
    renderAdmin(<ReportsPage />, { path: '/admin/reports', pattern: '/admin/reports' });
    await screen.findByRole('table');
    await chooseAdminSelect(u, 'Fila', 'Encerradas');
    await waitFor(() => expect(mocked.fetchAdminReports).toHaveBeenLastCalledWith({ status: 'closed', targetType: undefined }, null));
    await chooseAdminSelect(u, 'Tipo de alvo', 'Grupos');
    await waitFor(() => expect(mocked.fetchAdminReports).toHaveBeenLastCalledWith({ status: 'closed', targetType: 'group' }, null));
  });

  it('opening the queue never fetches any evidence', async () => {
    renderAdmin(<ReportsPage />, { path: '/admin/reports', pattern: '/admin/reports' });
    await screen.findByRole('table');
    expect(mocked.fetchAdminReport).not.toHaveBeenCalled();
  });
});

describe('ReportDetailPage', () => {
  it('the evidence is inert text: a URL inside it is not a link and nothing is fetched for it', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ snapshot: { text: 'veja https://evil.example/x <img src=x onerror=alert(1)>', authorId: null } }));
    const { container } = openDetail();
    expect(await screen.findByText(/veja https:\/\/evil.example\/x/)).toBeInTheDocument();
    expect(container.querySelector('a[href*="evil.example"]')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('for a message report the outcomes are delete, suspend the author, no action, dismiss — never suspend the group', async () => {
    openDetail();
    await screen.findByText('texto da mensagem');
    const labels = screen.getAllByRole('radio').map((r) => r.closest('label')!.textContent);
    expect(labels).toEqual([
      expect.stringContaining('Apagar a mensagem'), expect.stringContaining('Suspender a conta'),
      expect.stringContaining('Resolver sem ação'), expect.stringContaining('Dispensar'),
    ]);
    expect(screen.queryByRole('radio', { name: /Suspender o grupo/ })).not.toBeInTheDocument();
  });

  it('a group report only offers the group; a user report only the account', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ targetType: 'group', targetId: 'g1', targetLabel: 'Squad', snapshot: {} }));
    const { unmount } = openDetail();
    await screen.findByRole('radio', { name: /Suspender o grupo/ });
    expect(screen.queryByRole('radio', { name: /Apagar a mensagem/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Suspender a conta/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir no admin' })).toHaveAttribute('data-to', '/admin/groups/g1');
    unmount();

    mocked.fetchAdminReport.mockResolvedValue(detail({ targetType: 'user', targetId: 'u1', targetLabel: 'ana', snapshot: {} }));
    openDetail();
    await screen.findByRole('radio', { name: /Suspender a conta/ });
    expect(screen.queryByRole('radio', { name: /Suspender o grupo/ })).not.toBeInTheDocument();
  });

  it('nothing is decided before an outcome is chosen and confirmed with a reason', async () => {
    const u = userEvent.setup();
    mocked.resolveReport.mockResolvedValue({ ok: true });
    openDetail();
    const go = await screen.findByRole('button', { name: 'Escolha um desfecho' });
    expect(go).toBeDisabled();
    await u.click(screen.getByRole('radio', { name: /Apagar a mensagem/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Apagar a mensagem' }));
    expect(mocked.resolveReport).not.toHaveBeenCalled();
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed offense');
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocked.resolveReport).toHaveBeenCalledWith('r1', { reason: 'confirmed offense', action: 'delete_message', dismiss: false }));
  });

  it('the dialog states the concrete effect on the concrete target: suspending the author is not suspending the group', async () => {
    const u = userEvent.setup();
    openDetail();
    await u.click(await screen.findByRole('radio', { name: /Suspender a conta/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Suspender a conta' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('A conta perde a sessão agora');
  });

  it('resolve without action and dismiss send their own payloads; claim has its own endpoint', async () => {
    const u = userEvent.setup();
    mocked.claimReport.mockResolvedValue({ ok: true });
    mocked.resolveReport.mockResolvedValue({ ok: true });
    openDetail();
    await u.click(await screen.findByRole('button', { name: 'Assumir análise' }));
    await u.type(screen.getByLabelText(/Motivo/), 'will review');
    await u.click(screen.getByRole('button', { name: 'Assumir' }));
    await waitFor(() => expect(mocked.claimReport).toHaveBeenCalledWith('r1', 'will review'));

    await u.click(await screen.findByRole('radio', { name: /Resolver sem ação/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Resolver sem ação' }));
    await u.type(screen.getByLabelText(/Motivo/), 'handled elsewhere');
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(mocked.resolveReport).toHaveBeenLastCalledWith('r1', { reason: 'handled elsewhere', action: null, dismiss: false }));

    await u.click(await screen.findByRole('radio', { name: /Dispensar/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Dispensar' }));
    await u.type(screen.getByLabelText(/Motivo/), 'no problem');
    await u.click(screen.getAllByRole('button', { name: 'Dispensar' }).at(-1)!);
    await waitFor(() => expect(mocked.resolveReport).toHaveBeenLastCalledWith('r1', { reason: 'no problem', action: null, dismiss: true }));
  });

  it('a report already under analysis offers no claim', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ status: 'reviewing', assignee: 'lune' }));
    openDetail();
    await screen.findByText('texto da mensagem');
    expect(screen.queryByRole('button', { name: 'Assumir análise' })).not.toBeInTheDocument();
    expect(screen.getByText('@lune')).toBeInTheDocument();
  });

  it('a closed report shows result, reason and date, and no decision controls', async () => {
    mocked.fetchAdminReport.mockResolvedValue(detail({ status: 'resolved', resolution: 'message_deleted', resolutionNote: 'removed', resolvedAt: '2026-01-02T00:00:00.000Z' }));
    openDetail();
    expect(await screen.findByText('Mensagem apagada')).toBeInTheDocument();
    expect(screen.getByText('“removed”')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Decisão' })).not.toBeInTheDocument();
  });

  it('a report somebody else closed meanwhile: explains it, re-reads, and does not claim success', async () => {
    const u = userEvent.setup();
    mocked.resolveReport.mockRejectedValue(new ApiError(409, 'already_closed', 'x'));
    openDetail();
    await u.click(await screen.findByRole('radio', { name: /Dispensar/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Dispensar' }));
    await u.type(screen.getByLabelText(/Motivo/), 'no problem');
    mocked.fetchAdminReport.mockResolvedValue(detail({ status: 'dismissed', resolution: 'no_action', resolutionNote: 'by other', resolvedAt: '2026-01-02T00:00:00.000Z' }));
    await u.click(screen.getAllByRole('button', { name: 'Dispensar' }).at(-1)!);
    expect(await screen.findByRole('alert')).toHaveTextContent('já foi encerrada por outra pessoa');
    await waitFor(() => expect(mocked.fetchAdminReport).toHaveBeenCalledTimes(2));
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    const outcome = (await screen.findByRole('heading', { name: 'Desfecho' })).closest('section')!;
    expect(outcome).toHaveTextContent('Dispensada');
  });

  it('a failed action keeps the report open and says so', async () => {
    const u = userEvent.setup();
    mocked.resolveReport.mockRejectedValue(new ApiError(409, 'action_failed', 'x'));
    openDetail();
    await u.click(await screen.findByRole('radio', { name: /Apagar a mensagem/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Apagar a mensagem' }));
    await u.type(screen.getByLabelText(/Motivo/), 'confirmed offense');
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('a denúncia continua aberta');
    await u.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByRole('radio', { name: /Apagar a mensagem/ })).toBeChecked();
  });

  it('another decision in progress on the same report: told to refresh, not a generic failure', async () => {
    const u = userEvent.setup();
    mocked.resolveReport.mockRejectedValue(new ApiError(409, 'conflict', 'Outra decisão sobre esta denúncia está em andamento. Atualize e confira o resultado.'));
    openDetail();
    await u.click(await screen.findByRole('radio', { name: /Resolver sem ação/ }));
    await u.click(screen.getByRole('button', { name: 'Continuar: Resolver sem ação' }));
    await u.type(screen.getByLabelText(/Motivo/), 'handled elsewhere');
    await u.click(screen.getByRole('button', { name: 'Confirmar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Outra decisão sobre esta denúncia está em andamento');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/shared/api/api';
import type { DataExport, DataExportStatus } from '@/shared/api/api';
import { DataExportSettings } from '@/features/settings/DataExportSettings';

const fetchDataExportStatus = vi.fn();
const requestDataExport = vi.fn();

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchDataExportStatus: (...args: unknown[]) => fetchDataExportStatus(...args),
  requestDataExport: (...args: unknown[]) => requestDataExport(...args),
}));

const exportOf = (status: DataExport['status'], extra: Partial<DataExport> = {}): DataExport => ({
  id: '6f1c1a52-3b55-4a5e-9a51-000000000001', status, requestedAt: '2026-11-12T10:00:00.000Z', completedAt: null, expiresAt: null, sizeBytes: null, ...extra,
});
const statusOf = (latest: DataExport | null, nextRequestAt: string | null = null): DataExportStatus => ({ latest, nextRequestAt });

beforeEach(() => {
  fetchDataExportStatus.mockReset();
  requestDataExport.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('DataExportSettings', () => {
  it('asks for a copy and shows that it is being prepared', async () => {
    const user = userEvent.setup();
    fetchDataExportStatus.mockResolvedValueOnce(statusOf(null)).mockResolvedValue(statusOf(exportOf('pending'), '2026-11-13T10:00:00.000Z'));
    requestDataExport.mockResolvedValue({ export: exportOf('pending') });
    render(<DataExportSettings />);
    await user.click(await screen.findByRole('button', { name: 'Pedir cópia' }));
    expect(requestDataExport).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Preparando…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('o link também chega por e-mail');
  });

  it('offers the download of a ready copy, with its size and expiry, until another can be asked for', async () => {
    fetchDataExportStatus.mockResolvedValue(statusOf(
      exportOf('ready', { completedAt: '2026-11-12T10:05:00.000Z', expiresAt: '2026-11-19T10:05:00.000Z', sizeBytes: 3 * 1024 * 1024 }),
      '2026-11-13T10:00:00.000Z',
    ));
    render(<DataExportSettings />);
    const link = await screen.findByRole('link', { name: 'Baixar' });
    expect(link).toHaveAttribute('href', '/api/account/data-export/6f1c1a52-3b55-4a5e-9a51-000000000001/download');
    expect(screen.getByText(/Sua cópia \(3\.0 MB\) fica disponível até/)).toBeInTheDocument();
    expect(screen.getByText(/Você pode pedir outra cópia a partir de/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pedir cópia' })).not.toBeInTheDocument();
  });

  it('keeps the request disabled within the daily limit', async () => {
    fetchDataExportStatus.mockResolvedValue(statusOf(exportOf('expired'), '2026-11-13T10:00:00.000Z'));
    render(<DataExportSettings />);
    expect(await screen.findByText('O link da última cópia expirou.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pedir cópia' })).toBeDisabled();
  });

  it('says when the copy failed and lets the person ask again', async () => {
    fetchDataExportStatus.mockResolvedValue(statusOf(exportOf('failed')));
    render(<DataExportSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível preparar sua cópia.');
    expect(screen.getByRole('button', { name: 'Pedir cópia' })).toBeEnabled();
  });

  it('shows a refused request and reloads the state', async () => {
    const user = userEvent.setup();
    fetchDataExportStatus.mockResolvedValue(statusOf(null));
    requestDataExport.mockRejectedValue(new ApiError(503, 'internal_error', 'x'));
    render(<DataExportSettings />);
    await user.click(await screen.findByRole('button', { name: 'Pedir cópia' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(fetchDataExportStatus).toHaveBeenCalledTimes(2);
  });

  it('looks again while the copy is being prepared, and stops once it is ready', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const ready = exportOf('ready', { expiresAt: '2026-11-19T10:05:00.000Z', sizeBytes: 10 });
    fetchDataExportStatus.mockResolvedValueOnce(statusOf(exportOf('running'))).mockResolvedValue(statusOf(ready));
    render(<DataExportSettings />);
    expect(await screen.findByRole('button', { name: 'Preparando…' })).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(await screen.findByRole('link', { name: 'Baixar' })).toBeInTheDocument();
    const calls = fetchDataExportStatus.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    await waitFor(() => expect(fetchDataExportStatus.mock.calls.length).toBe(calls));
  });
});

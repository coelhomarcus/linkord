import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { AccessNotice, AccountNotice } from '@/app/layout/AccessNotice';
import type { AccountNotice as AccountNoticeValue } from '@/state/AuthContext';

const auth = vi.hoisted(() => ({ accountNotice: null as AccountNoticeValue | null, clearAccountNotice: vi.fn() }));
vi.mock('@/state/AuthContext', () => ({ useAuth: () => auth }));

afterEach(() => vi.useRealTimers());

describe('AccessNotice', () => {
  it('renders nothing without a notice', () => {
    renderWithRoom(<AccessNotice />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the notice and allows dismissing it', async () => {
    const user = userEvent.setup();
    const clear = vi.fn();
    renderWithRoom(<AccessNotice />, { accessNotice: 'Você foi removido do servidor "Squad".', clearAccessNotice: clear });
    expect(screen.getByRole('status')).toHaveTextContent('Você foi removido do servidor "Squad".');
    await user.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(clear).toHaveBeenCalled();
  });

  it('disappears on its own after a while', () => {
    vi.useFakeTimers();
    const clear = vi.fn();
    renderWithRoom(<AccessNotice />, { accessNotice: 'aviso', clearAccessNotice: clear });
    act(() => { vi.advanceTimersByTime(10_500); });
    expect(clear).toHaveBeenCalled();
  });
});

describe('AccountNotice', () => {
  it('renders nothing without a notice for the app', () => {
    auth.accountNotice = { kind: 'deletionScheduled', dueAt: '2026-11-26T12:00:00.000Z' };
    renderWithRoom(<AccountNotice />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('says a sign-in cancelled the scheduled deletion', async () => {
    auth.accountNotice = { kind: 'deletionCancelled' };
    auth.clearAccountNotice.mockReset();
    renderWithRoom(<AccountNotice />);
    expect(screen.getByRole('status')).toHaveTextContent('Exclusão da conta cancelada.');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(auth.clearAccountNotice).toHaveBeenCalled();
  });
});

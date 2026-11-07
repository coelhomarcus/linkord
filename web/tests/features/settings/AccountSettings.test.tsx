import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { AccountSettings } from '@/features/settings/AccountSettings';
import { formatStorage } from '@/features/settings/formatStorage';

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: { email: 'ana@example.com' } }),
}));

const MB = 1024 * 1024;
const GB = 1024 * MB;

function renderAccount(storageUsage: { totalBytes: number; totalFiles: number; maxBytes: number }) {
  return renderWithRoom(<MemoryRouter><AccountSettings onOpenProfile={vi.fn()} /></MemoryRouter>, { storageUsage });
}

describe('formatStorage', () => {
  it('uses MB below a gigabyte and GB from there up, in pt-BR', () => {
    expect(formatStorage(12.4 * MB)).toBe('12,4 MB');
    expect(formatStorage(0)).toBe('0 MB');
    expect(formatStorage(GB / 2)).toBe('512 MB');
    expect(formatStorage(1.5 * GB)).toBe('1,5 GB');
    expect(formatStorage(5 * GB)).toBe('5 GB');
  });
});

describe('AccountSettings', () => {
  it('describes the quota in pt-BR, with the file count in the singular when it is one', () => {
    renderAccount({ totalBytes: 8.3 * MB, totalFiles: 1, maxBytes: 5 * GB });
    expect(screen.getByText('8,3 MB de 5 GB da sua cota usados, 1 arquivo enviado.')).toBeInTheDocument();
  });

  it('keeps any usage visible on the bar while reporting the real value', () => {
    renderAccount({ totalBytes: MB, totalFiles: 4, maxBytes: 5 * GB });
    const bar = screen.getByRole('progressbar', { name: 'Armazenamento usado' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar.firstElementChild).toHaveStyle({ width: '2%' });
  });

  it('edits the display name in your own profile', async () => {
    const onOpenProfile = vi.fn();
    renderWithRoom(<MemoryRouter><AccountSettings onOpenProfile={onOpenProfile} /></MemoryRouter>, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u-ana' } },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Editar perfil' }));
    expect(onOpenProfile).toHaveBeenCalledWith('u-ana');
  });
});

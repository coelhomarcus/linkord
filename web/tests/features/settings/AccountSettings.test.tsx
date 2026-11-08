import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { AccountSettings } from '@/features/settings/AccountSettings';

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn(), user: { email: 'ana@example.com' } }),
}));

describe('AccountSettings', () => {
  it('lists the account information as rows, with the email hidden up to the @', () => {
    renderWithRoom(<MemoryRouter><AccountSettings onOpenProfile={vi.fn()} /></MemoryRouter>, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u-ana', name: 'ana', displayName: 'Ana Lima' } },
    });
    expect(screen.getByRole('heading', { name: 'Informações da conta' })).toBeInTheDocument();
    expect(screen.getByText('Nome de usuário')).toBeInTheDocument();
    expect(screen.getByText('Ana Lima')).toBeInTheDocument();
    expect(screen.getByText('***@example.com')).toBeInTheDocument();
  });

  it('has no storage section: accounts have no storage quota of their own', () => {
    renderWithRoom(<MemoryRouter><AccountSettings onOpenProfile={vi.fn()} /></MemoryRouter>);
    expect(screen.queryByRole('heading', { name: 'Armazenamento' })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('edits the display name in your own profile', async () => {
    const onOpenProfile = vi.fn();
    renderWithRoom(<MemoryRouter><AccountSettings onOpenProfile={onOpenProfile} /></MemoryRouter>, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'u-ana' } },
    });
    // the first "Editar" is the display name's; the email has its own
    await userEvent.setup().click(screen.getAllByRole('button', { name: 'Editar' })[0]!);
    expect(onOpenProfile).toHaveBeenCalledWith('u-ana');
  });
});

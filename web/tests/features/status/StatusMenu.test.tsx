import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { initialRoomState } from '@/state/roomReducer';
import { StatusMenu } from '@/features/status/StatusMenu';
import type { OwnStatus } from '@/shared/types/protocol';

vi.mock('@/features/profile/profileApi', () => ({
  fetchWall: vi.fn().mockResolvedValue({ widgets: [], available: [] }),
}));

const me = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Fulana' } };

function renderMenu(ownStatus: OwnStatus = { status: 'online', effective: 'online', customStatus: null }) {
  const setPresence = vi.fn().mockResolvedValue(undefined);
  const onOpenProfile = vi.fn();
  const onError = vi.fn();
  renderWithRoom(
    <StatusMenu trigger={<button type="button">Status e perfil</button>} onOpenProfile={onOpenProfile} onError={onError} />,
    { state: me, ownStatus, setPresence },
  );
  return { setPresence, onOpenProfile, onError, user: userEvent.setup() };
}

describe('StatusMenu', () => {
  it('lists the four statuses with the current one checked', async () => {
    const { user } = renderMenu({ status: 'dnd', effective: 'dnd', customStatus: null });
    await user.click(screen.getByRole('button', { name: 'Status e perfil' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Disponível'), expect.stringContaining('Ausente'),
      expect.stringContaining('Não perturbe'), expect.stringContaining('Invisível'),
    ]);
    expect(screen.getByRole('menuitemradio', { name: /Não perturbe/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('picking a status sends it', async () => {
    const { user, setPresence } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Status e perfil' }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Invisível/ }));
    expect(setPresence).toHaveBeenCalledWith({ status: 'invisible' });
  });

  it('a refused change is reported', async () => {
    const { user, setPresence, onError } = renderMenu();
    setPresence.mockRejectedValueOnce(new Error('Não foi possível mudar seu status. Tente de novo.'));
    await user.click(screen.getByRole('button', { name: 'Status e perfil' }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Ausente/ }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Não foi possível mudar seu status. Tente de novo.'));
  });

  it('shows the custom status and clears it', async () => {
    const { user, setPresence } = renderMenu({ status: 'online', effective: 'online', customStatus: { emoji: '🎮', text: 'jogando Elden Ring', expiresAt: null } });
    await user.click(screen.getByRole('button', { name: 'Status e perfil' }));
    expect(await screen.findByText('jogando Elden Ring')).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'Limpar status personalizado' }));
    expect(setPresence).toHaveBeenCalledWith({ customStatus: null });
  });

  it('opens the profile and the custom status editor', async () => {
    const { user, onOpenProfile } = renderMenu();
    await user.click(screen.getByRole('button', { name: 'Status e perfil' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Ver perfil' }));
    expect(onOpenProfile).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Status e perfil' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Definir status personalizado' }));
    expect(await screen.findByRole('dialog', { name: 'Status personalizado' })).toBeInTheDocument();
  });
});

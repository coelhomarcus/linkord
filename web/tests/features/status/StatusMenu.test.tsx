import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { initialRoomState } from '@/state/roomReducer';
import { StatusMenu } from '@/features/status/StatusMenu';
import type { OwnStatus } from '@/shared/types/protocol';
import { liveAnnouncements } from '@tests/fixtures/announcerFixture';

vi.mock('@/features/profile/profileApi', () => ({
  fetchWall: vi.fn().mockResolvedValue({ widgets: [], available: [] }),
}));

const me = {
  ...initialRoomState,
  me: { ...initialRoomState.me, userId: 'user-42', name: 'fulana', displayName: 'Fulana', profileLinks: ['https://github.com/fulana'] },
};

function renderMenu(ownStatus: OwnStatus = { status: 'online', effective: 'online', customStatus: null }, reconnecting = false) {
  const setPresence = vi.fn().mockResolvedValue(undefined);
  const onOpenProfile = vi.fn();
  const onError = vi.fn();
  renderWithRoom(
    <StatusMenu trigger={<button type="button">Status e perfil</button>} onOpenProfile={onOpenProfile} onError={onError} />,
    { state: me, ownStatus, setPresence, reconnecting },
  );
  return { setPresence, onOpenProfile, onError, user: userEvent.setup() };
}

async function openCard(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Status e perfil' }));
  return screen.findByRole('dialog', { name: 'Status e perfil' });
}

describe('StatusMenu', () => {
  it('opens a card with who you are: name, username, status and links', async () => {
    const { user } = renderMenu({ status: 'dnd', effective: 'dnd', customStatus: null });
    const card = await openCard(user);
    expect(within(card).getByRole('heading', { name: 'Fulana' })).toBeInTheDocument();
    expect(within(card).getByText('fulana')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/fulana');
    expect(within(card).getByRole('button', { name: 'Status: Não perturbe' })).toBeInTheDocument();
  });

  it('the status row opens the four statuses with the current one checked', async () => {
    const { user } = renderMenu({ status: 'dnd', effective: 'dnd', customStatus: null });
    await openCard(user);
    await user.click(screen.getByRole('button', { name: 'Status: Não perturbe' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('Disponível'), expect.stringContaining('Ausente'),
      expect.stringContaining('Não perturbe'), expect.stringContaining('Invisível'),
    ]);
    expect(screen.getByRole('menuitemradio', { name: /Não perturbe/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /Invisível/ })).toHaveTextContent('Você aparece offline');
  });

  it('picking a status sends it and keeps the card open', async () => {
    const { user, setPresence } = renderMenu();
    await openCard(user);
    await user.click(screen.getByRole('button', { name: 'Status: Disponível' }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Invisível/ }));
    expect(setPresence).toHaveBeenCalledWith({ status: 'invisible' });
    expect(screen.getByRole('dialog', { name: 'Status e perfil' })).toBeInTheDocument();
  });

  it('a refused change is reported', async () => {
    const { user, setPresence, onError } = renderMenu();
    setPresence.mockRejectedValueOnce(new Error('Não foi possível mudar seu status. Tente de novo.'));
    await openCard(user);
    await user.click(screen.getByRole('button', { name: 'Status: Disponível' }));
    await user.click(await screen.findByRole('menuitemradio', { name: /Ausente/ }));
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Não foi possível mudar seu status. Tente de novo.'));
  });

  it('shows the custom status in the bubble and clears it from there', async () => {
    const { user, setPresence } = renderMenu({ status: 'online', effective: 'online', customStatus: { emoji: '🎮', text: 'jogando Elden Ring', expiresAt: null } });
    const card = await openCard(user);
    expect(within(card).getByText('jogando Elden Ring').closest('[data-custom-status-bubble]')).not.toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Limpar status personalizado' }));
    expect(setPresence).toHaveBeenCalledWith({ customStatus: null });
  });

  it('the bubble opens the custom status editor, closing the card', async () => {
    const { user } = renderMenu();
    const card = await openCard(user);
    await user.click(within(card).getByRole('button', { name: 'Definir status personalizado' }));
    expect(await screen.findByRole('dialog', { name: 'Status personalizado' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Status e perfil' })).not.toBeInTheDocument();
  });

  it('edits the profile', async () => {
    const { user, onOpenProfile } = renderMenu();
    const card = await openCard(user);
    await user.click(within(card).getByRole('button', { name: 'Editar perfil' }));
    expect(onOpenProfile).toHaveBeenCalled();
  });

  it('copies the user ID and says so', async () => {
    const { user } = renderMenu();
    const card = await openCard(user);
    await user.click(within(card).getByRole('button', { name: /Copiar ID do usuário/ }));
    await expect(navigator.clipboard.readText()).resolves.toBe('user-42');
    expect(within(card).getByRole('button', { name: /Copiar ID do usuário/ })).toHaveTextContent('Copiado');
    expect(liveAnnouncements()).toEqual(['Copiado']);
  });

  it('while reconnecting the status row says so and cannot be changed', async () => {
    const { user } = renderMenu(undefined, true);
    const card = await openCard(user);
    expect(within(card).getByRole('button', { name: 'Status: Reconectando…' })).toBeDisabled();
  });

  it('is usable from the keyboard: arrows move between rows, Escape returns to the panel', async () => {
    const { user } = renderMenu();
    screen.getByRole('button', { name: 'Status e perfil' }).focus();
    await user.keyboard('{Enter}');
    const card = await screen.findByRole('dialog', { name: 'Status e perfil' });
    within(card).getByRole('button', { name: 'Editar perfil' }).focus();
    await user.keyboard('{ArrowDown}');
    expect(within(card).getByRole('button', { name: 'Status: Disponível' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menuitemradio', { name: /Disponível/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument());
    await user.keyboard('{ArrowDown}');
    expect(within(card).getByRole('button', { name: /Copiar ID do usuário/ })).toHaveFocus();
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Status e perfil' })).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Status e perfil' })).toHaveFocus();
  });
});

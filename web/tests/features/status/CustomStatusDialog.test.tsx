import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { initialRoomState } from '@/state/roomReducer';
import { CustomStatusDialog } from '@/features/status/CustomStatusDialog';
import { fetchWall } from '@/features/profile/profileApi';
import type { OwnStatus } from '@/shared/types/protocol';

vi.mock('@/features/profile/profileApi', () => ({ fetchWall: vi.fn() }));

const me = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Fulana' } };
const game = { igdbId: 1, name: 'Elden Ring', slug: 'elden-ring', coverImageId: null, releaseYear: 2022, url: '', imageUrl: null };

function renderDialog(ownStatus: OwnStatus = { status: 'online', effective: 'online', customStatus: null }) {
  const setPresence = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  renderWithRoom(<CustomStatusDialog open onOpenChange={onOpenChange} />, { state: me, ownStatus, setPresence });
  return { setPresence, onOpenChange, user: userEvent.setup() };
}

beforeEach(() => {
  vi.mocked(fetchWall).mockReset().mockResolvedValue({ widgets: [], available: [] });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 8, 20, 0));
});

afterEach(() => { vi.useRealTimers(); });

describe('CustomStatusDialog', () => {
  it('saves the text, clearing at the end of today by default', async () => {
    const { user, setPresence, onOpenChange } = renderDialog();
    await user.type(screen.getByLabelText('Texto'), '  estudando  ');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(setPresence).toHaveBeenCalledWith({
      customStatus: { emoji: '', text: 'estudando', expiresAt: new Date(2026, 10, 9, 0, 0).toISOString() },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saving an empty draft clears the status', async () => {
    const { user, setPresence } = renderDialog({ status: 'online', effective: 'online', customStatus: { emoji: '', text: 'old', expiresAt: null } });
    await user.clear(screen.getByLabelText('Texto'));
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(setPresence).toHaveBeenCalledWith({ customStatus: null });
  });

  it('keeps an existing expiry unless another is picked', async () => {
    const expiresAt = new Date(2026, 10, 8, 22, 0).toISOString();
    const { user, setPresence } = renderDialog({ status: 'online', effective: 'online', customStatus: { emoji: '🎮', text: 'x', expiresAt } });
    expect(screen.getByLabelText('Limpar depois de')).toHaveTextContent('até 22:00');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(setPresence).toHaveBeenCalledWith({ customStatus: { emoji: '🎮', text: 'x', expiresAt } });
  });

  it('a game in rotation fills the status in one click', async () => {
    vi.mocked(fetchWall).mockResolvedValue({ widgets: [], available: [{ connection: null, type: 'igdb-playing-games', data: { kind: 'games', items: [game] } }] });
    const { user, setPresence } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Elden Ring' }));
    expect(screen.getByLabelText('Texto')).toHaveValue('jogando Elden Ring');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(setPresence).toHaveBeenCalledWith({ customStatus: expect.objectContaining({ emoji: '🎮', text: 'jogando Elden Ring' }) });
  });

  it('a refused save keeps the editor open with the reason', async () => {
    const { user, setPresence, onOpenChange } = renderDialog();
    setPresence.mockRejectedValueOnce(new Error('Não foi possível mudar seu status. Tente de novo.'));
    await user.type(screen.getByLabelText('Texto'), 'oi');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível mudar seu status');
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

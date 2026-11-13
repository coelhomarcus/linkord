import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { DmCallOverlay } from '@/features/calls/DmCallOverlay';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { DmCallNotice } from '@/features/calls/useDmCall';
import { startRingtone } from '@/shared/sounds';
import type { PublicUser } from '@/shared/types/protocol';

vi.mock('@/shared/sounds', () => ({ playSound: vi.fn(), startRingtone: vi.fn(() => () => {}) }));

const peer: PublicUser = {
  id: 'peer', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: '#335577',
  banner: '', bio: '', profileLinks: [], role: 'user',
};

function notice(over: Partial<DmCallNotice> = {}): DmCallNotice {
  return {
    callId: 'k', conversationId: 'c1', video: false, phase: 'incoming',
    callerId: 'peer', peerId: 'peer', ...over,
  };
}

type Actions = { acceptDmCall?: () => void; declineDmCall?: () => void; cancelDmCall?: () => void; dismissDmCallNotice?: () => void };

function renderDialog(dmCall: DmCallNotice | null, actions: Actions = {}) {
  return renderWithRoom(<DmCallOverlay />, { dmCall, allUsers: new Map([['peer', peer]]), ...actions });
}

describe('DmCallOverlay', () => {
  it('an incoming call is a modal dialog named after the caller, with accept and decline', () => {
    const acceptDmCall = vi.fn();
    const declineDmCall = vi.fn();
    renderDialog(notice(), { acceptDmCall, declineDmCall });
    const dialog = screen.getByRole('dialog', { name: 'Ana' });
    expect(dialog).toHaveAccessibleDescription('Chamada de voz');
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Atender' }));
    expect(declineDmCall).toHaveBeenCalledOnce();
    expect(acceptDmCall).toHaveBeenCalledOnce();
  });

  it('a video call says so', () => {
    renderDialog(notice({ video: true }));
    expect(screen.getByRole('dialog', { name: 'Ana' })).toHaveAccessibleDescription('Chamada de vídeo');
  });

  it('focuses the dialog itself, so typing Enter cannot answer the call', async () => {
    renderDialog(notice());
    const dialog = screen.getByRole('dialog', { name: 'Ana' });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(screen.getByRole('button', { name: 'Atender' })).not.toHaveFocus();
  });

  it('Escape does not decline a ringing call', () => {
    const declineDmCall = vi.fn();
    const dismissDmCallNotice = vi.fn();
    renderDialog(notice(), { declineDmCall, dismissDmCallNotice });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Ana' })).toBeInTheDocument();
    expect(declineDmCall).not.toHaveBeenCalled();
    expect(dismissDmCallNotice).not.toHaveBeenCalled();
  });

  it('an outgoing call can be cancelled', () => {
    const cancelDmCall = vi.fn();
    renderDialog(notice({ phase: 'outgoing' }), { cancelDmCall });
    expect(screen.getByRole('dialog', { name: 'Ana' })).toHaveAccessibleDescription('Chamando…');
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancelDmCall).toHaveBeenCalledOnce();
  });

  it('a failed call says so and closes only when dismissed', () => {
    const dismissDmCallNotice = vi.fn();
    renderDialog(notice({ phase: 'ended', reason: 'failed', peerId: '' }), { dismissDmCallNotice });
    expect(screen.getByRole('dialog', { name: 'Não foi possível conectar a chamada' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atender' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(dismissDmCallNotice).toHaveBeenCalledOnce();
  });

  it('shows nothing without a call', () => {
    renderDialog(null);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rings while the call is waiting and stops when the dialog goes away', () => {
    const stop = vi.fn();
    vi.mocked(startRingtone).mockReturnValueOnce(stop);
    const { unmount } = renderDialog(notice({ phase: 'outgoing' }));
    expect(startRingtone).toHaveBeenLastCalledWith('outgoing');
    expect(stop).not.toHaveBeenCalled();
    unmount();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('does not ring for a call that failed', () => {
    vi.mocked(startRingtone).mockClear();
    renderDialog(notice({ phase: 'ended', reason: 'failed' }));
    expect(startRingtone).not.toHaveBeenCalled();
  });
});

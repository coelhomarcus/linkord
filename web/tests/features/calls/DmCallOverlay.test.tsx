import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { DmCallOverlay } from '@/features/calls/DmCallOverlay';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { DmCallNotice } from '@/features/calls/useDmCall';
import type { PublicUser } from '@/shared/types/protocol';

vi.mock('@/shared/sounds', () => ({ playSound: vi.fn() }));

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

function renderCard(dmCall: DmCallNotice, actions: { acceptDmCall?: () => void; declineDmCall?: () => void; cancelDmCall?: () => void } = {}) {
  return renderWithRoom(<DmCallOverlay />, { dmCall, allUsers: new Map([['peer', peer]]), ...actions });
}

describe('DmCallOverlay', () => {
  it('an incoming call offers accept and decline', () => {
    const acceptDmCall = vi.fn();
    const declineDmCall = vi.fn();
    renderCard(notice(), { acceptDmCall, declineDmCall });
    expect(screen.getByRole('dialog', { name: 'Chamada de voz' })).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Atender' }));
    expect(declineDmCall).toHaveBeenCalledOnce();
    expect(acceptDmCall).toHaveBeenCalledOnce();
  });

  it('an outgoing call can be cancelled', () => {
    const cancelDmCall = vi.fn();
    renderCard(notice({ phase: 'outgoing' }), { cancelDmCall });
    expect(screen.getByRole('dialog', { name: 'Chamando…' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancelDmCall).toHaveBeenCalledOnce();
  });

  it('a declined call says so and offers nothing else to press', () => {
    renderCard(notice({ phase: 'ended', reason: 'declined' }));
    expect(screen.getByRole('dialog', { name: 'Chamada recusada' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Atender' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();
  });
});

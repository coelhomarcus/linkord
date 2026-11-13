import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CallMoveDialog } from '@/features/calls/CallMoveDialog';
import type { Conversation, PublicUser } from '@/shared/types/protocol';

const lounge: Conversation = { id: 'voice-1', type: 'voice', title: 'Lounge', serverId: 's1', memberIds: [], lastMessageAt: null, createdAt: 0, updatedAt: 0 };
const dm: Conversation = { id: 'dm-1', type: 'direct', title: '', serverId: null, memberIds: ['me', 'ana'], lastMessageAt: 1, createdAt: 0, updatedAt: 0 };
const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-me', userId: 'me' } };
const users = new Map([['ana', { id: 'ana', username: 'ana', displayName: 'Ana' } as PublicUser]]);

function renderDialog(overrides: Parameters<typeof renderWithRoom>[1]) {
  return renderWithRoom(<CallMoveDialog />, { state, conversations: [lounge, dm], allUsers: users, ...overrides });
}

describe('CallMoveDialog', () => {
  it('names the voice channel the account is in elsewhere, and moves it on confirm', async () => {
    const confirm = vi.fn();
    renderDialog({
      callElsewhere: { participantId: 'conn-phone', conversationId: 'voice-1', kind: 'voice' },
      callMove: { open: true, confirm, cancel: vi.fn() },
    });

    expect(screen.getByRole('dialog', { name: 'Trazer a chamada para esta aba?' })).toBeInTheDocument();
    expect(screen.getByText(/Sua conta está em Lounge em outra aba ou dispositivo/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Entrar por aqui' }));
    expect(confirm).toHaveBeenCalled();
  });

  it('names the person of a direct call', () => {
    renderDialog({
      callElsewhere: { participantId: 'conn-phone', conversationId: 'dm-1', kind: 'direct' },
      callMove: { open: true, confirm: vi.fn(), cancel: vi.fn() },
    });
    expect(screen.getByText(/em uma chamada com Ana em outra aba/)).toBeInTheDocument();
  });

  it('cancelling leaves the call where it is', async () => {
    const cancel = vi.fn();
    const confirm = vi.fn();
    renderDialog({
      callElsewhere: { participantId: 'conn-phone', conversationId: 'voice-1', kind: 'voice' },
      callMove: { open: true, confirm, cancel },
    });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancel).toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('stays closed until a request needs it', () => {
    renderDialog({ callElsewhere: null, callMove: { open: false, confirm: vi.fn(), cancel: vi.fn() } });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CallDock } from '@/features/calls/CallDock';
import type { Conversation } from '@/shared/types/protocol';

const group: Conversation = {
  id: 'conv-1', type: 'group', title: 'os xerecas', avatar: '', createdBy: 'me', memberIds: ['me'],
  lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'owner', ownerId: 'me', memberCount: 1,
};

const me = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Fulana' } };

function renderDock(room: Parameters<typeof renderWithRoom>[1] = {}, {
  onReturnToCall = vi.fn(),
  onOpenProfile = vi.fn(),
  showReturnToCall = true,
  layout = 'wide',
  path = '/app/conversations',
}: {
  onReturnToCall?: () => void;
  onOpenProfile?: (userId: string) => void;
  showReturnToCall?: boolean;
  layout?: 'wide' | 'compact';
  path?: string;
} = {}) {
  const result = renderWithRoom(
    <MemoryRouter initialEntries={[path]}>
      <CallDock onReturnToCall={onReturnToCall} onOpenProfile={onOpenProfile} showReturnToCall={showReturnToCall} layout={layout} />
    </MemoryRouter>,
    {
      state: me,
      conversations: [group],
      ...room,
    },
  );
  return { onReturnToCall, onOpenProfile, ...result };
}

describe('CallDock — idle', () => {
  it('opens the account profile from the dock', () => {
    const onOpenProfile = vi.fn();
    renderDock({}, { onOpenProfile });
    fireEvent.click(screen.getByRole('button', { name: 'Meu perfil' }));
    expect(onOpenProfile).toHaveBeenCalledWith('me');
  });

  it('stores mute preference while idle', () => {
    const setPreferMuted = vi.fn();
    renderDock({ setPreferMuted });
    fireEvent.click(screen.getByLabelText('Mutar'));
    expect(setPreferMuted).toHaveBeenCalledWith(true);
  });

  it('shows the stored mute preference as already muted', () => {
    renderDock({ preferMuted: true });
    expect(screen.getByLabelText('Desmutar')).toBeInTheDocument();
  });
});

describe('CallDock — settings', () => {
  it('has the settings gear: a button that opens the settings dialog, not a link', () => {
    renderDock();
    const gear = screen.getByRole('button', { name: 'Ajustes' });
    expect(gear).not.toHaveAttribute('href');
    expect(gear).toHaveAttribute('aria-haspopup', 'dialog');
    expect(gear).toHaveAttribute('aria-expanded', 'false');
  });

  it('marks the gear as open while settings are', () => {
    renderDock({}, { path: '/app/settings/av' });
    expect(screen.getByRole('button', { name: 'Ajustes' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('CallDock — in a call', () => {
  it('hides Voltar à chamada while the stage is already in focus', () => {
    renderDock({ activeCallConversationId: 'conv-1' }, { showReturnToCall: false });
    expect(screen.getByText('Em chamada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar à chamada' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sair da chamada')).toBeInTheDocument();
  });

  it('clicking Voltar à chamada returns to the stage', () => {
    const onReturnToCall = vi.fn();
    renderDock({ activeCallConversationId: 'conv-1' }, { onReturnToCall });
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à chamada' }));
    expect(onReturnToCall).toHaveBeenCalledTimes(1);
  });
});

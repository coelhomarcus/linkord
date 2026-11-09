import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CallDock } from '@/features/calls/CallDock';
import type { Conversation } from '@/shared/types/protocol';

const group: Conversation = {
  id: 'conv-1', type: 'voice', title: 'os xerecas', serverId: 's1', memberIds: ['me'],
  lastMessageAt: null, createdAt: 0, updatedAt: 0,
};

const me = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me', displayName: 'Fulana' } };

function renderDock(room: Parameters<typeof renderWithRoom>[1] = {}, {
  onReturnToCall = vi.fn(),
  onOpenProfile = vi.fn(),
  layout = 'wide',
  path = '/app/conversations',
}: {
  onReturnToCall?: () => void;
  onOpenProfile?: (userId: string) => void;
  layout?: 'wide' | 'compact';
  path?: string;
} = {}) {
  const result = renderWithRoom(
    <MemoryRouter initialEntries={[path]}>
      <CallDock onReturnToCall={onReturnToCall} onOpenProfile={onOpenProfile} layout={layout} />
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
  it('opens the account profile from the status card', async () => {
    const onOpenProfile = vi.fn();
    renderDock({}, { onOpenProfile });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Status e perfil' }));
    await user.click(await screen.findByRole('button', { name: 'Editar perfil' }));
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
  it('has no Voltar à chamada button, only the leave button', () => {
    renderDock({ activeCallConversationId: 'conv-1' });
    expect(screen.getByText('Em chamada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Voltar à chamada' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Sair da chamada')).toBeInTheDocument();
  });

  it('the call name under Em chamada returns to the stage', () => {
    const onReturnToCall = vi.fn();
    renderDock({ activeCallConversationId: 'conv-1' }, { onReturnToCall });
    fireEvent.click(screen.getByRole('button', { name: 'os xerecas' }));
    expect(onReturnToCall).toHaveBeenCalledTimes(1);
  });

  it('keeps the account name and status in the row while in a call', () => {
    renderDock({ activeCallConversationId: 'conv-1' });
    expect(screen.getByText('Fulana')).toBeInTheDocument();
    expect(screen.getByText('Disponível')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Status e perfil' })).toBeInTheDocument();
  });

  it('shows the account name and status while idle', () => {
    renderDock();
    expect(screen.getByText('Fulana')).toBeInTheDocument();
    expect(screen.getByText('Disponível')).toBeInTheDocument();
  });
});

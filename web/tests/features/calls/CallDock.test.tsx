import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { Room, Track } from 'livekit-client';
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
  it('shows the account and mute/deafen, not call-only controls', () => {
    renderDock();
    expect(screen.getByRole('button', { name: 'Meu perfil' })).toHaveTextContent('Fulana');
    expect(screen.getByLabelText('Mutar')).toBeInTheDocument();
    expect(screen.getByLabelText('Parar de ouvir')).toBeInTheDocument();
    expect(screen.queryByText('Em chamada')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Ligar câmera')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Compartilhar tela')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Sair da chamada')).not.toBeInTheDocument();
  });

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

describe('CallDock — online status', () => {
  const status = () => document.querySelector('[data-status]');

  it('shows the green online dot on the avatar, in both layouts', () => {
    const { unmount } = renderDock();
    expect(status()).toHaveAttribute('data-status', 'online');
    expect(status()).toHaveClass('bg-green');
    unmount();
    renderDock({}, { layout: 'compact' });
    expect(status()).toHaveAttribute('data-status', 'online');
  });

  it('turns the dot gray while the connection is being re-established', () => {
    renderDock({ reconnecting: true });
    expect(status()).toHaveAttribute('data-status', 'reconnecting');
    expect(status()).not.toHaveClass('bg-green');
  });
});

describe('CallDock — settings', () => {
  it('has the settings gear, linking to the settings page', () => {
    renderDock();
    expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('href', '/app/settings');
    expect(screen.getByRole('link', { name: 'Ajustes' })).not.toHaveAttribute('aria-current');
  });

  it('marks the gear as the current page inside settings', () => {
    renderDock({}, { path: '/app/settings/av' });
    expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('CallDock — compact layout (only the rail is on screen)', () => {
  it('keeps every control but drops the name, which stays as the profile button label', () => {
    renderDock({}, { layout: 'compact' });
    const profile = screen.getByRole('button', { name: 'Meu perfil' });
    expect(profile).not.toHaveTextContent('Fulana');
    expect(screen.getByLabelText('Mutar')).toBeInTheDocument();
    expect(screen.getByLabelText('Parar de ouvir')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ajustes' })).toBeInTheDocument();
  });

  it('in a call, returns to the stage and leaves it through icon buttons', () => {
    const onReturnToCall = vi.fn();
    renderDock({ activeCallConversationId: 'conv-1' }, { layout: 'compact', onReturnToCall });
    expect(screen.queryByText('Em chamada')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à chamada' }));
    expect(onReturnToCall).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Sair da chamada')).toBeInTheDocument();
    expect(screen.getByLabelText('Ligar câmera')).toBeInTheDocument();
    expect(screen.getByLabelText('Compartilhar tela')).toBeInTheDocument();
  });
});

describe('CallDock — in a call', () => {
  it('keeps the account and adds the connected status plus call controls', () => {
    renderDock({ activeCallConversationId: 'conv-1' });
    expect(screen.getByRole('button', { name: 'Meu perfil' })).toHaveTextContent('Fulana');
    expect(screen.getByText('Em chamada')).toBeInTheDocument();
    expect(screen.getByText('os xerecas')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar à chamada' })).toHaveTextContent('Voltar à chamada');
    expect(screen.getByLabelText('Ativar microfone')).toBeInTheDocument();
    expect(screen.getByLabelText('Parar de ouvir')).toBeInTheDocument();
    expect(screen.getByLabelText('Ligar câmera')).toBeInTheDocument();
    expect(screen.getByLabelText('Compartilhar tela')).toBeInTheDocument();
    expect(screen.getByLabelText('Sair da chamada')).toBeInTheDocument();
  });

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

  it('triggers toggleMicMuted when clicking the mic control', () => {
    const toggleMicMuted = vi.fn();
    const livekitRoom = new Room();
    vi.spyOn(livekitRoom.localParticipant, 'getTrackPublication').mockImplementation((source) => (
      source === Track.Source.Microphone ? { isMuted: true, track: undefined } as never : undefined
    ));
    renderDock({ activeCallConversationId: 'conv-1', toggleMicMuted, livekitRoom });
    fireEvent.click(screen.getByLabelText('Desmutar'));
    expect(toggleMicMuted).toHaveBeenCalledTimes(1);
  });

  it('triggers leaveCall when clicking leave call', () => {
    const leaveCall = vi.fn();
    renderDock({ activeCallConversationId: 'conv-1', leaveCall });
    fireEvent.click(screen.getByLabelText('Sair da chamada'));
    expect(leaveCall).toHaveBeenCalledTimes(1);
  });

  it('does not render Stage-only chrome (reactions, fullscreen, mic notices)', () => {
    renderDock({ activeCallConversationId: 'conv-1', state: { ...me, micProblem: 'not-found' } });
    expect(screen.queryByLabelText('Reagir')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Tela cheia')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

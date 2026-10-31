import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Room, Track } from 'livekit-client';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CallControlBar } from '@/features/calls/CallControlBar';

describe('CallControlBar', () => {
  it('triggers toggleMicMuted when clicking the mic control', () => {
    const toggleMicMuted = vi.fn();
    const livekitRoom = new Room();
    vi.spyOn(livekitRoom.localParticipant, 'getTrackPublication').mockImplementation((source) => (
      source === Track.Source.Microphone ? { isMuted: true, track: undefined } as never : undefined
    ));
    renderWithRoom(<CallControlBar />, { toggleMicMuted, livekitRoom });
    fireEvent.click(screen.getByLabelText('Desmutar'));
    expect(toggleMicMuted).toHaveBeenCalledTimes(1);
  });

  it('with no mic published, the button tries to activate the mic instead of muting', () => {
    const activateMic = vi.fn();
    const toggleMicMuted = vi.fn();
    renderWithRoom(<CallControlBar />, { activateMic, toggleMicMuted });
    fireEvent.click(screen.getByLabelText('Ativar microfone'));
    expect(activateMic).toHaveBeenCalledTimes(1);
    expect(toggleMicMuted).not.toHaveBeenCalled();
  });

  it('with no mic connected, warns on the button and with a notice that only disappears when dismissed', () => {
    renderWithRoom(<CallControlBar />, { state: { ...initialRoomState, micProblem: 'not-found' } });
    expect(screen.getByLabelText('Nenhum microfone encontrado')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Conecte um microfone');
    fireEvent.click(screen.getByLabelText('Dispensar aviso'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // the button keeps saying it even after the notice is dismissed
    expect(screen.getByLabelText('Nenhum microfone encontrado')).toBeInTheDocument();
  });

  it('with the mic blocked by the browser, explains how to unblock it', () => {
    renderWithRoom(<CallControlBar />, { state: { ...initialRoomState, micProblem: 'denied' } });
    expect(screen.getByLabelText('Microfone bloqueado pelo navegador')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('permissões do site');
  });

  it('triggers leaveCall when clicking leave call', () => {
    const leaveCall = vi.fn();
    renderWithRoom(<CallControlBar />, { leaveCall });
    fireEvent.click(screen.getByLabelText('Sair da chamada'));
    expect(leaveCall).toHaveBeenCalledTimes(1);
  });

  it('shows the share error notice when present', () => {
    renderWithRoom(<CallControlBar />, {
      state: { ...initialRoomState, shareError: 'Nao foi possivel acessar a camera.' },
    });
    expect(screen.getByText('Nao foi possivel acessar a camera.')).toBeInTheDocument();
  });

  it('mic that fails to start: suggests it may be in use by another application', () => {
    renderWithRoom(<CallControlBar />, { state: { ...initialRoomState, micProblem: 'unavailable' } });
    expect(screen.getByLabelText('Microfone indisponível')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('em uso por outro aplicativo');
  });

  it('shows the fullscreen button and triggers toggleCallFullscreen when clicked', () => {
    const toggleCallFullscreen = vi.fn();
    renderWithRoom(<CallControlBar />, { toggleCallFullscreen });
    fireEvent.click(screen.getByLabelText('Tela cheia'));
    expect(toggleCallFullscreen).toHaveBeenCalledTimes(1);
  });

  it('when already in fullscreen, the button offers to exit', () => {
    renderWithRoom(<CallControlBar />, { isCallFullscreen: true });
    expect(screen.getByLabelText('Sair da tela cheia')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tela cheia')).not.toBeInTheDocument();
  });
});

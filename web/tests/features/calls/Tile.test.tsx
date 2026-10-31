import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { Tile } from '@/features/calls/Tile';
import type { Participant } from '@/shared/types/protocol';

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-2', userId: 'u-2', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'conv-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

describe('Tile — muted for me', () => {
  it('unmutes the participant on click, and never offers that on your own tile', () => {
    const audio = new Audio();
    audio.volume = 0;
    const participants = new Map([['p-2', fakeParticipant()]]);
    const { unmount } = renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      audioRegistry: { current: new Map([['p-2', { element: audio }]]) },
    });

    fireEvent.click(screen.getByLabelText('Reativar áudio'));
    expect(audio.volume).toBeCloseTo(0.4);
    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
    unmount();

    const own = new Audio();
    own.volume = 0;
    renderWithRoom(<Tile participantId="p-1" kind="avatar" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      audioRegistry: { current: new Map([['p-1', { element: own }]]) },
    });
    expect(screen.queryByLabelText('Reativar áudio')).not.toBeInTheDocument();
  });
});

describe('Tile — mirroring', () => {
  it('mirrors only my own camera, and only while the preference is on', () => {
    const mine = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: true,
    });
    expect(mine.container.querySelector('video')).toHaveStyle({ transform: 'scaleX(-1)' });
    mine.unmount();

    const off = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: false,
    });
    expect(off.container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
    off.unmount();

    const other = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
      mirrorCameraPreview: true,
    });
    expect(other.container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
    other.unmount();

    const screenShare = renderWithRoom(<Tile participantId="p-1" kind="screen" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      mirrorCameraPreview: true,
    });
    expect(screenShare.container.querySelector('video')).not.toHaveStyle({ transform: 'scaleX(-1)' });
  });
});

describe('Tile — video hidden for me', () => {
  it('hides another person\'s camera, and never my own camera or a shared screen', () => {
    const hidden = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]), hiddenVideoKeys: new Set(['p-2:participant']) },
    });
    expect(hidden.container.querySelector('video')).not.toBeInTheDocument();
    expect(screen.getByText('Vídeo oculto')).toBeInTheDocument();
    hidden.unmount();

    const mine = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, hiddenVideoKeys: new Set(['p-1:participant']) },
    });
    expect(mine.container.querySelector('video')).toBeInTheDocument();
    mine.unmount();

    const shared = renderWithRoom(<Tile participantId="p-2" kind="screen" isMine={false} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]), hiddenVideoKeys: new Set(['p-2:screen']) },
    });
    expect(shared.container.querySelector('video')).toBeInTheDocument();
    expect(screen.queryByText('Vídeo oculto')).not.toBeInTheDocument();
  });
});

describe('Tile — paused share and stopped watching', () => {
  it('a paused share says so, and stopping watching wins over the pause', () => {
    const paused = renderWithRoom(<Tile participantId="p-2" kind="screen" isMine={false} paused />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(paused.container.querySelector('video')).not.toBeInTheDocument();
    expect(screen.getByText('Prévia pausada')).toBeInTheDocument();
    paused.unmount();

    const stopped = renderWithRoom(<Tile participantId="p-2" kind="screen" isMine={false} paused />, {
      state: {
        ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants: new Map([['p-2', fakeParticipant()]]),
        unwatchedScreenKeys: new Set(['p-2:screen']),
      },
    });
    expect(screen.getByText('Você parou de assistir')).toBeInTheDocument();
    expect(screen.queryByText('Prévia pausada')).not.toBeInTheDocument();
    stopped.unmount();

    const own = renderWithRoom(<Tile participantId="p-1" kind="screen" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, unwatchedScreenKeys: new Set(['p-1:screen']) },
    });
    expect(own.container.querySelector('video')).toBeInTheDocument();
    expect(screen.queryByText('Você parou de assistir')).not.toBeInTheDocument();
  });
});

describe('Tile — keyboard', () => {
  it('Enter focuses the tile, and Enter on the gear does not', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: null },
      dispatch,
      openTileMenu: vi.fn(),
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /Destacar Fulana/ }), { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-2:participant', origin: 'manual' });

    fireEvent.keyDown(screen.getByLabelText('Configurações da transmissão'), { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

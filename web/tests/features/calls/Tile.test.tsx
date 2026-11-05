import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { initialRoomState } from '@/state/roomReducer';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';
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

function setVideoSize(video: HTMLVideoElement, width: number, height: number, event = 'loadedmetadata') {
  Object.defineProperties(video, {
    videoWidth: { configurable: true, value: width },
    videoHeight: { configurable: true, value: height },
  });
  fireEvent(video, new Event(event));
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

describe('Tile — media aspect ratio', () => {
  it('letterboxes inside a fixed-size tile instead of resizing it or cropping', () => {
    const contain = renderWithRoom(<Tile participantId="p-1" kind="screen" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
    });
    expect(contain.container.querySelector('video')).toHaveClass('object-contain');
    expect(contain.container.querySelector('[data-tile-kind]')).not.toHaveAttribute('style', expect.stringContaining('width'));
    contain.unmount();

    const cover = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine fit="cover" />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
    });
    expect(cover.container.querySelector('video')).toHaveClass('object-cover');
    expect(cover.container.querySelector('video')?.className).toContain('[:fullscreen_&]:object-contain');
  });
});

describe('Tile — video background', () => {
  it.each(['camera', 'screen'] as const)('uses black behind a %s even with a profile banner', (kind) => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind={kind} isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant({ banner: '/banner.webp', bannerPoster: '/poster.webp' })]]) },
    });
    expect(container.querySelector('[data-tile-kind]')).toHaveClass('bg-bg-call');
    expect(container.querySelector('video')).toHaveClass('bg-bg-call', 'object-contain');
    expect(container.querySelector<HTMLElement>('[data-tile-kind]')!.style.background).toBe('');
    expect(container.querySelector('[style*="background-image"]')).not.toBeInTheDocument();
  });

  it('uses black instead of the profile tint when no banner is configured', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]) },
    });
    expect(container.querySelector('[data-tile-kind]')).toHaveClass('bg-bg-call');
    expect(container.querySelector('[style*="color-mix"]')).not.toBeInTheDocument();
  });

  it.each(['avatar', 'camera'] as const)('preserves the banner for an %s presentation without video', (kind) => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind={kind} isMine={false} sizing="source" />, {
      state: {
        ...initialRoomState,
        participants: new Map([['p-2', fakeParticipant({ banner: '/banner.webp', bannerPoster: '/poster.webp' })]]),
        hiddenVideoKeys: new Set(['p-2:participant']),
      },
    });
    expect(container.querySelector('video')).not.toBeInTheDocument();
    expect(container.querySelector('[style*="poster.webp"]')).toBeInTheDocument();
    expect(container.querySelector('[data-tile-kind]')).not.toHaveAttribute('style', expect.stringContaining('width'));
  });
});

describe('Tile — focused source sizing', () => {
  let resizeSlot: (width: number, height: number) => void;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      private readonly callback: ResizeObserverCallback;
      constructor(callback: ResizeObserverCallback) { this.callback = callback; }
      observe() {
        resizeSlot = (width, height) => this.callback(
          [{ contentRect: { width, height } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
        resizeSlot(800, 600);
      }
      disconnect = disconnect;
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    [1920, 1080, 800, 450],
    [640, 480, 800, 600],
    [720, 1280, 337.5, 600],
    [2560, 1080, 800, 337.5],
  ])('fits a %ix%i source within its slot', (width, height, expectedW, expectedH) => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} sizing="source" />);
    const video = container.querySelector('video')!;
    const frame = container.querySelector<HTMLElement>('[data-tile-kind]')!;
    setVideoSize(video, width, height);
    expect(parseFloat(frame.style.width)).toBeCloseTo(expectedW);
    expect(parseFloat(frame.style.height)).toBeCloseTo(expectedH);
  });

  it('falls back to 16:9 until metadata is available and handles zero dimensions', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="screen" isMine={false} sizing="source" />);
    const frame = container.querySelector('[data-tile-kind]')!;
    expect(frame).toHaveStyle({ width: '800px', height: '450px' });
    setVideoSize(container.querySelector('video')!, 0, 0);
    expect(frame).toHaveStyle({ width: '800px', height: '450px' });
  });

  it('updates orientation and available space without replacing the video or registered frame', () => {
    const value = createFakeRoomContextValue();
    const { container, unmount } = renderWithRoom(<Tile participantId="p-2" kind="screen" isMine={false} sizing="source" />, value);
    const video = container.querySelector('video')!;
    const frame = container.querySelector('[data-tile-kind]')!;
    setVideoSize(video, 1920, 1080);
    setVideoSize(video, 720, 1280, 'resize');
    expect(frame).toHaveStyle({ width: '337.5px', height: '600px' });
    act(() => resizeSlot(400, 800));
    expect(frame).toHaveStyle({ width: '400px' });
    expect(parseFloat((frame as HTMLElement).style.height)).toBeCloseTo(711.111);
    expect(container.querySelector('video')).toBe(video);
    expect(value.tileDomRegistry.current.get('p-2:screen')).toEqual({ root: frame, video });
    unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(value.tileDomRegistry.current.has('p-2:screen')).toBe(false);
  });

  it('accounts for the border without letterboxing the focused video', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} sizing="source" />);
    const frame = container.querySelector<HTMLElement>('[data-tile-kind]')!;
    frame.style.borderWidth = '3.5px';
    act(() => resizeSlot(800, 600));
    setVideoSize(container.querySelector('video')!, 720, 1280);
    expect(parseFloat(frame.style.height)).toBe(600);
    expect((parseFloat(frame.style.width) - 7) / (parseFloat(frame.style.height) - 7)).toBeCloseTo(720 / 1280);
  });

  it('resets the old ratio when the source changes and restores paused screen video', () => {
    const value = createFakeRoomContextValue();
    const renderTile = (kind: 'camera' | 'screen', paused = false) => (
      <RoomContext.Provider value={value}>
        <Tile participantId="p-2" kind={kind} isMine={false} sizing="source" paused={paused} />
      </RoomContext.Provider>
    );
    const { container, rerender } = renderWithRoom(renderTile('camera'), value);
    setVideoSize(container.querySelector('video')!, 720, 1280);
    rerender(renderTile('screen'));
    const frame = container.querySelector('[data-tile-kind]')!;
    expect(frame).toHaveStyle({ width: '800px', height: '450px' });
    setVideoSize(container.querySelector('video')!, 640, 480);
    expect(frame).toHaveStyle({ width: '800px', height: '600px' });
    rerender(renderTile('screen', true));
    expect(container.querySelector('video')).not.toBeInTheDocument();
    expect(frame).not.toHaveAttribute('style', expect.stringContaining('width'));
    rerender(renderTile('screen'));
    setVideoSize(container.querySelector('video')!, 720, 1280);
    expect(frame).toHaveStyle({ width: '337.5px', height: '600px' });
  });

  it('resets dimensions when a track is replaced and reattaches after hiding a camera', () => {
    const first = { attach: vi.fn(), detach: vi.fn() };
    const second = { attach: vi.fn(), detach: vi.fn() };
    let camera = first;
    const on = vi.fn();
    const room = {
      on, off: vi.fn(),
      localParticipant: { identity: 'p-1', getTrackPublication: () => undefined },
      getParticipantByIdentity: () => ({
        getTrackPublication: (source: Track.Source) => source === Track.Source.Camera ? { isMuted: false, track: camera } : undefined,
      }),
    } as unknown as Room;
    const value = createFakeRoomContextValue({ livekitRoom: room });
    const renderTile = () => (
      <RoomContext.Provider value={value}>
        <Tile participantId="p-2" kind="camera" isMine={false} sizing="source" />
      </RoomContext.Provider>
    );
    const { container, rerender } = renderWithRoom(renderTile(), value);
    const firstVideo = container.querySelector('video')!;
    setVideoSize(firstVideo, 720, 1280);
    camera = second;
    act(() => on.mock.calls.find(([event]) => event === 'trackSubscribed')![1]());
    expect(first.detach).toHaveBeenCalledWith(firstVideo);
    expect(second.attach).toHaveBeenCalledWith(firstVideo);
    expect(container.querySelector('[data-tile-kind]')).toHaveStyle({ width: '800px', height: '450px' });
    value.state = { ...value.state, hiddenVideoKeys: new Set(['p-2:participant']) };
    rerender(renderTile());
    expect(second.detach).toHaveBeenCalledWith(firstVideo);
    value.state = { ...value.state, hiddenVideoKeys: new Set() };
    rerender(renderTile());
    const restoredVideo = container.querySelector('video')!;
    expect(restoredVideo).not.toBe(firstVideo);
    expect(second.attach).toHaveBeenLastCalledWith(restoredVideo);
    setVideoSize(restoredVideo, 1920, 1080);
    expect(container.querySelector('[data-tile-kind]')).toHaveStyle({ width: '800px', height: '450px' });
  });

  it('keeps grid tiles fixed when source dimensions change', () => {
    const { container } = renderWithRoom(<Tile participantId="p-2" kind="camera" isMine={false} />);
    setVideoSize(container.querySelector('video')!, 720, 1280);
    expect(container.querySelector('[data-tile-kind]')).not.toHaveAttribute('style', expect.stringContaining('width'));
  });
});

describe('Tile — name pill icon', () => {
  it('marks a screen share with a green monitor instead of the avatar', () => {
    const screenShare = renderWithRoom(<Tile participantId="p-1" kind="screen" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', displayName: 'Eu' } },
    });
    const pill = screenShare.getByText('Eu').parentElement!;
    expect(pill.querySelector('svg.text-green')).toBeInTheDocument();
    expect(pill.querySelector('[data-avatar], img')).not.toBeInTheDocument();
    screenShare.unmount();

    const camera = renderWithRoom(<Tile participantId="p-1" kind="camera" isMine />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', displayName: 'Eu' } },
    });
    expect(camera.getByText('Eu').parentElement!.querySelector('svg.text-green')).not.toBeInTheDocument();
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
  it('Enter focuses the tile and there is no gear button', () => {
    const dispatch = vi.fn();
    renderWithRoom(<Tile participantId="p-2" kind="avatar" isMine={false} />, {
      state: { ...initialRoomState, participants: new Map([['p-2', fakeParticipant()]]), focusedId: null },
      dispatch,
      openTileMenu: vi.fn(),
    });
    fireEvent.keyDown(screen.getByRole('button', { name: /Destacar Fulana/ }), { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_FOCUSED', id: 'p-2:participant', origin: 'manual' });

    expect(screen.queryByLabelText('Configurações da transmissão')).not.toBeInTheDocument();
  });
});

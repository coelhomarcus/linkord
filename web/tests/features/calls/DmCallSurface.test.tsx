import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { initialRoomState } from '@/state/roomReducer';
import type { TileDescriptor } from '@/features/calls/tileTypes';
import { DmCallSurface } from '@/features/calls/DmCallSurface';

const tiles = vi.hoisted(() => ({ current: [] as TileDescriptor[] }));

vi.mock('@/features/calls/useCallTiles', () => ({ useCallTiles: () => tiles.current }));
vi.mock('@/features/calls/CallControlBar', () => ({ CallControlBar: () => null }));
vi.mock('@/features/calls/Tile', () => ({
  Tile: ({ participantId, kind }: { participantId: string; kind: string }) => <div data-testid={`tile-${participantId}-${kind}`} />,
}));
vi.mock('@/features/calls/DmCallAvatar', () => ({
  DmCallAvatar: ({ peer }: { peer: { id: string } }) => <div data-testid={`avatar-${peer.id}`} />,
}));

const peers = [
  { id: 'a', name: 'Ana', avatar: '', avatarColor: 'blue' },
  { id: 'b', name: 'Bea', avatar: '', avatarColor: 'green' },
];

function tile(participantId: string, kind: TileDescriptor['kind'], extra: Partial<TileDescriptor> = {}): TileDescriptor {
  return { key: `${participantId}:${kind === 'screen' ? 'screen' : 'participant'}`, participantId, kind, loading: false, paused: false, ...extra };
}

const OriginalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  // a call area of a real size, so the layout has room to place video
  globalThis.ResizeObserver = class {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 900, height: 300 } } as unknown as ResizeObserverEntry], this as unknown as ResizeObserver);
    }
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  globalThis.ResizeObserver = OriginalResizeObserver;
});

function area(): string | null {
  return document.querySelector('[data-dm-call-area]')?.getAttribute('data-dm-call-area') ?? null;
}

describe('DmCallSurface', () => {
  it('shows everyone as an avatar while nobody publishes video', () => {
    tiles.current = [tile('a', 'avatar'), tile('b', 'avatar')];
    const { getByTestId, queryByTestId } = renderWithRoom(<DmCallSurface participantIds={['a', 'b']} peers={peers} />);
    expect(area()).toBe('avatars');
    expect(getByTestId('avatar-a')).toBeInTheDocument();
    expect(getByTestId('avatar-b')).toBeInTheDocument();
    expect(queryByTestId('tile-a-avatar')).not.toBeInTheDocument();
  });

  it('turns only the person on camera into a video tile', () => {
    tiles.current = [tile('a', 'camera'), tile('b', 'avatar')];
    const { getByTestId, queryByTestId } = renderWithRoom(<DmCallSurface participantIds={['a', 'b']} peers={peers} />);
    expect(area()).toBe('videos');
    expect(getByTestId('tile-a-camera')).toBeInTheDocument();
    expect(queryByTestId('avatar-a')).not.toBeInTheDocument();
    expect(getByTestId('avatar-b')).toBeInTheDocument();
    expect(queryByTestId('tile-b-avatar')).not.toBeInTheDocument();
  });

  it('keeps someone whose camera is still attaching as an avatar', () => {
    tiles.current = [tile('a', 'avatar', { loading: true }), tile('b', 'avatar')];
    const { getByTestId } = renderWithRoom(<DmCallSurface participantIds={['a', 'b']} peers={peers} />);
    expect(area()).toBe('avatars');
    expect(getByTestId('avatar-a')).toBeInTheDocument();
  });

  it('gives a focused screen share the room and keeps the others beside it', () => {
    tiles.current = [tile('a', 'screen'), tile('a', 'avatar'), tile('b', 'avatar')];
    const { getByTestId } = renderWithRoom(<DmCallSurface participantIds={['a', 'b']} peers={peers} />, {
      state: { ...initialRoomState, focusedId: 'a:screen', focusOrigin: 'automatic' },
    });
    expect(area()).toBe('focus');
    expect(getByTestId('tile-a-screen')).toBeInTheDocument();
    const strip = document.querySelector('[data-dm-call-strip]');
    expect(strip).not.toBeNull();
    expect(strip?.querySelector('[data-testid="avatar-a"]')).not.toBeNull();
    expect(strip?.querySelector('[data-testid="avatar-b"]')).not.toBeNull();
  });
});

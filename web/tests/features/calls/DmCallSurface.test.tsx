import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { TileDescriptor } from '@/features/calls/tileTypes';
import { DmCallSurface } from '@/features/calls/DmCallSurface';

const tiles = vi.hoisted(() => ({ current: [] as TileDescriptor[] }));

vi.mock('@/features/calls/useCallTiles', () => ({ useCallTiles: () => tiles.current }));
vi.mock('@/features/calls/CallControlBar', () => ({ CallControlBar: () => null }));
vi.mock('@/features/calls/TileGrid', () => ({ TileGrid: () => <div data-testid="tile-grid" /> }));

const peers = [
  { id: 'a', name: 'Ana', avatar: '', avatarColor: 'blue' },
  { id: 'b', name: 'Bea', avatar: '', avatarColor: 'green' },
];

describe('DmCallSurface', () => {
  it('renders avatars until someone publishes media', () => {
    tiles.current = [{ key: 'a:participant', participantId: 'a', kind: 'avatar', loading: false, paused: false }];
    const { unmount } = renderWithRoom(<DmCallSurface participantIds={['a', 'b']} peers={peers} />);
    expect(screen.getByTestId('dm-call-avatars')).toBeInTheDocument();
    expect(screen.queryByTestId('dm-call-tiles')).not.toBeInTheDocument();
    unmount();

    tiles.current = [{ key: 'a:participant', participantId: 'a', kind: 'camera', loading: false, paused: false }];
    renderWithRoom(<DmCallSurface participantIds={['a', 'b']} peers={peers} />);
    expect(screen.getByTestId('dm-call-tiles')).toBeInTheDocument();
  });
});

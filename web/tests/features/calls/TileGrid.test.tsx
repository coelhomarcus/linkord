import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { TileDescriptor } from '@/features/calls/tileTypes';
import { TileGrid } from '@/features/calls/TileGrid';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';

vi.stubGlobal(
  'ResizeObserver',
  class {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe() {
      this.callback(
        [{ contentRect: { width: 600, height: 600 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {}

    disconnect() {}
  },
);

vi.mock('@/features/calls/Tile', () => ({
  Tile: ({ participantId, fit }: { participantId: string; fit?: string }) => <div data-testid={`tile-${participantId}`} data-fit={fit} />,
}));

function descriptors(count: number): TileDescriptor[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `p-${index}:avatar`,
    participantId: `p-${index}`,
    kind: 'avatar' as const,
    loading: false,
    paused: false,
  }));
}

describe('TileGrid', () => {
  it('the thumbnail strip is collapsible', async () => {
    const user = userEvent.setup();
    const all = descriptors(3);
    const { container, getByRole } = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} />);

    expect(container.querySelector('[data-thumb-strip]')).toBeInTheDocument();
    await user.click(getByRole('button', { name: 'Ocultar participantes' }));
    expect(container.querySelector('[data-thumb-strip]')).not.toBeInTheDocument();
    await user.click(getByRole('button', { name: 'Mostrar participantes' }));
    expect(container.querySelector('[data-thumb-strip]')).toBeInTheDocument();
  });

  it('focuses the camera and screen of the SAME person independently (distinct keys per source)', () => {
    const camera: TileDescriptor = { key: 'u1:participant', participantId: 'u1', kind: 'camera', loading: false, paused: false };
    const screen: TileDescriptor = { key: 'u1:screen', participantId: 'u1', kind: 'screen', loading: false, paused: false };

    // focusing the camera key: the main slot gets one tile, the strip gets
    // the other — proving the two sources of the same person are tracked
    // (and focusable) independently, not merged into one "u1" identity
    const onCamera = renderWithRoom(<TileGrid descriptors={[camera, screen]} focusedId="u1:participant" />);
    expect(onCamera.container.querySelectorAll('[data-testid="tile-u1"]')).toHaveLength(2);
    expect(onCamera.container.querySelector('[data-thumb-strip] [data-testid="tile-u1"]')).toBeInTheDocument();
    onCamera.unmount();

    // focusing the screen key instead: still exactly one main + one strip tile
    const onScreen = renderWithRoom(<TileGrid descriptors={[camera, screen]} focusedId="u1:screen" />);
    expect(onScreen.container.querySelectorAll('[data-testid="tile-u1"]')).toHaveLength(2);
    expect(onScreen.container.querySelector('[data-thumb-strip] [data-testid="tile-u1"]')).toBeInTheDocument();
  });
});

describe('TileGrid — onCapacityChange', () => {
  it('reports meetsMinimum=true when tiles fit within the default minTileWidth', () => {
    const onCapacityChange = vi.fn();
    renderWithRoom(<TileGrid descriptors={descriptors(2)} focusedId={null} onCapacityChange={onCapacityChange} />);
    expect(onCapacityChange).toHaveBeenCalledWith(true, 'p-0:avatar');
  });

  it('reports meetsMinimum=false when the required minTileWidth does not fit (fake container is 600x600)', () => {
    const onCapacityChange = vi.fn();
    renderWithRoom(<TileGrid descriptors={descriptors(9)} focusedId={null} minTileWidth={1000} onCapacityChange={onCapacityChange} />);
    expect(onCapacityChange).toHaveBeenCalledWith(false, 'p-0:avatar');
  });
});

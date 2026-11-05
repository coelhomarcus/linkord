import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import type { TileDescriptor } from '@/features/calls/tileTypes';
import { TileGrid } from '@/features/calls/TileGrid';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue, renderWithRoom } from '@tests/fixtures/roomContextFixture';

let resizeContainer: (width: number, height: number) => void = () => {};

vi.stubGlobal(
  'ResizeObserver',
  class {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe() {
      resizeContainer = (width, height) => this.callback(
        [{ contentRect: { width, height } } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
      resizeContainer(600, 600);
    }

    unobserve() {}

    disconnect() {}
  },
);

vi.mock('@/features/calls/Tile', () => ({
  Tile: ({ participantId, fit = 'contain', sizing }: { participantId: string; fit?: string; sizing?: string }) => (
    <div data-testid={`tile-${participantId}`} data-fit={fit} data-sizing={sizing} />
  ),
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
  it('keeps grid cells uniform and uses source sizing only for the focused tile', () => {
    const all = descriptors(3);
    const { container, rerender } = renderWithRoom(<TileGrid descriptors={all} focusedId={null} />);
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-tile-grid] > div'));
    for (const cell of cells) {
      expect(cell.style.width).toBe(cells[0]!.style.width);
      expect(cell.style.height).toBe(cells[0]!.style.height);
      expect(parseFloat(cell.style.width) / parseFloat(cell.style.height)).toBeCloseTo(16 / 9);
      expect(cell.firstElementChild).toHaveAttribute('data-sizing', 'fill');
    }
    const value = createFakeRoomContextValue();
    const renderGrid = (focusedId: string) => (
      <RoomContext.Provider value={value}><TileGrid descriptors={all} focusedId={focusedId} /></RoomContext.Provider>
    );
    rerender(renderGrid(all[0]!.key));
    expect(container.querySelector('[data-testid="tile-p-0"]')).toHaveAttribute('data-sizing', 'source');
    const thumbs = container.querySelectorAll('[data-thumb-strip] [data-testid]');
    expect(thumbs).toHaveLength(2);
    for (const thumb of thumbs) {
      expect(thumb).toHaveAttribute('data-fit', 'contain');
      expect(thumb).toHaveAttribute('data-sizing', 'fill');
      expect(thumb.parentElement).toHaveStyle({ width: '160px', height: '90px' });
    }
    rerender(renderGrid(all[1]!.key));
    expect(container.querySelector('[data-testid="tile-p-1"]')).toHaveAttribute('data-sizing', 'source');
    expect(container.querySelector('[data-testid="tile-p-0"]')).toHaveAttribute('data-sizing', 'fill');
  });

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

  it('the extra tile takes a grid cell, but has no place in focus mode', () => {
    const all = descriptors(1);
    const extra = <div data-testid="extra" />;
    const grid = renderWithRoom(<TileGrid descriptors={all} focusedId={null} extraTile={extra} />);
    const cells = grid.container.querySelectorAll('[data-tile-grid] > div');
    expect(cells).toHaveLength(2);
    expect(cells[1]!.querySelector('[data-testid="extra"]')).toBeInTheDocument();
    expect((cells[1] as HTMLElement).style.width).toBe((cells[0] as HTMLElement).style.width);
    grid.unmount();

    const focused = renderWithRoom(<TileGrid descriptors={all} focusedId={all[0]!.key} extraTile={extra} />);
    expect(focused.queryByTestId('extra')).not.toBeInTheDocument();
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

describe('TileGrid — capacity while the container resizes', () => {
  afterEach(() => vi.useRealTimers());

  it('ignores a width that is only crossed mid-animation', () => {
    vi.useFakeTimers();
    const onCapacityChange = vi.fn();
    renderWithRoom(<TileGrid descriptors={descriptors(3)} focusedId={null} onCapacityChange={onCapacityChange} />);
    onCapacityChange.mockClear();

    act(() => resizeContainer(200, 600));
    act(() => vi.advanceTimersByTime(100));
    act(() => resizeContainer(600, 600));
    act(() => vi.advanceTimersByTime(1_000));

    expect(onCapacityChange).not.toHaveBeenCalledWith(false, expect.anything());
  });

  it('reports a lack of room once the container holds still', () => {
    vi.useFakeTimers();
    const onCapacityChange = vi.fn();
    renderWithRoom(<TileGrid descriptors={descriptors(3)} focusedId={null} onCapacityChange={onCapacityChange} />);
    onCapacityChange.mockClear();

    act(() => resizeContainer(200, 600));
    expect(onCapacityChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));

    expect(onCapacityChange).toHaveBeenCalledWith(false, 'p-0:avatar');
  });
});

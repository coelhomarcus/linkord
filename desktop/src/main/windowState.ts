export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1280, height: 800 };
export const MIN_SIZE = { width: 360, height: 500 };

// Enough of the title bar on some screen to grab it and drag the window back
const MIN_VISIBLE = { width: 120, height: 40 };

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function parseWindowState(raw: unknown): WindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const { bounds, maximized } = raw as { bounds?: Partial<Rect>; maximized?: unknown };
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(isFiniteNumber)) return null;
  return {
    bounds: { x: bounds.x!, y: bounds.y!, width: bounds.width!, height: bounds.height! },
    maximized: maximized === true,
  };
}

const visibleArea = (a: Rect, b: Rect): Rect => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
};

/**
 * Where the window opens. The saved place is kept only while it is still on a
 * screen (a monitor that was unplugged would leave the window unreachable);
 * otherwise the window opens at the default size and the system centres it.
 */
export function placeWindow(saved: WindowState | null, workAreas: readonly Rect[]): {
  bounds: Partial<Rect> & { width: number; height: number };
  maximized: boolean;
} {
  if (!saved) return { bounds: { ...DEFAULT_SIZE }, maximized: false };
  const width = Math.max(MIN_SIZE.width, Math.round(saved.bounds.width));
  const height = Math.max(MIN_SIZE.height, Math.round(saved.bounds.height));
  const bounds = { x: Math.round(saved.bounds.x), y: Math.round(saved.bounds.y), width, height };
  const titleBar = { ...bounds, height: MIN_VISIBLE.height };
  const reachable = workAreas.some((area) => {
    const seen = visibleArea(titleBar, area);
    return seen.width >= MIN_VISIBLE.width && seen.height >= MIN_VISIBLE.height;
  });
  return reachable
    ? { bounds, maximized: saved.maximized }
    : { bounds: { width, height }, maximized: saved.maximized };
}

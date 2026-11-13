// The geometry of the viewer's zoom. Points are in CSS pixels relative to the
// centre of the stage, which is also where the picture sits at rest; the
// picture is moved by a translation and a scale about its own centre.

export const ZOOM = {
  min: 1,
  max: 5,
  /** where a double-click or a double tap goes */
  toggle: 2.5,
  /** one press of a zoom button */
  step: 1.25,
  /** how far a pointer may move and still count as a tap */
  tapPx: 20,
  /** how far one arrow key moves a zoomed picture */
  keyPanPx: 64,
} as const;

// treat a scale this close to 1 as the resting state (a pinch rarely lands exactly on it)
const EPSILON = 0.01;

export interface Point { x: number; y: number }
export interface Size { width: number; height: number }

export interface Transform {
  scale: number;
  x: number;
  y: number;
}

export const REST: Transform = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  return Math.min(ZOOM.max, Math.max(ZOOM.min, scale));
}

export function isZoomed(transform: Transform): boolean {
  return transform.scale > ZOOM.min + EPSILON;
}

/** Whether a rotation (any multiple of 90°, unbounded so CSS turns the short way) lies on its side. */
export function isSideways(degrees: number): boolean {
  return Math.abs(Math.round(degrees / 90)) % 2 === 1;
}

/** The size the picture is laid out at so that, turned by `degrees`, it fits the stage whole. Never
 * larger than the picture itself: a small one is shown at its own size, not blown up. */
export function fitSize(natural: Size, stage: Size, degrees = 0): Size {
  if (natural.width <= 0 || natural.height <= 0 || stage.width <= 0 || stage.height <= 0) return { width: 0, height: 0 };
  const sideways = isSideways(degrees);
  const footprint = sideways ? { width: natural.height, height: natural.width } : natural;
  const ratio = Math.min(1, stage.width / footprint.width, stage.height / footprint.height);
  return { width: natural.width * ratio, height: natural.height * ratio };
}

/** The room the picture takes on screen at rest, after turning: what pan limits are measured from. */
export function footprint(laidOut: Size, degrees = 0): Size {
  return isSideways(degrees) ? { width: laidOut.height, height: laidOut.width } : laidOut;
}

/** Keeps a zoomed picture covering the stage wherever it can: an edge never comes inside the stage
 * while there is more picture beyond it, and a dimension smaller than the stage stays centred. */
export function clampPan(point: Point, scale: number, picture: Size, stage: Size): Point {
  if (scale <= ZOOM.min + EPSILON) return { x: 0, y: 0 };
  const maxX = Math.max(0, (picture.width * scale - stage.width) / 2);
  const maxY = Math.max(0, (picture.height * scale - stage.height) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, point.x)) || 0,
    y: Math.min(maxY, Math.max(-maxY, point.y)) || 0,
  };
}

/** Zooms to `nextScale` keeping the spot of the picture under `anchor` (the cursor, a pinch's
 * centre) under it, then clamps. */
export function zoomAt(current: Transform, nextScale: number, anchor: Point, picture: Size, stage: Size): Transform {
  const scale = clampScale(nextScale);
  if (scale <= ZOOM.min + EPSILON) return REST;
  const ratio = scale / current.scale;
  const moved = {
    x: anchor.x - (anchor.x - current.x) * ratio,
    y: anchor.y - (anchor.y - current.y) * ratio,
  };
  return { scale, ...clampPan(moved, scale, picture, stage) };
}

/** A double-click or double tap: into `ZOOM.toggle` at the point, or back to rest. */
export function toggleZoom(current: Transform, anchor: Point, picture: Size, stage: Size): Transform {
  return isZoomed(current) ? REST : zoomAt(current, ZOOM.toggle, anchor, picture, stage);
}

/** One press of a zoom button (`direction` 1 in, -1 out), about the centre of the stage. */
export function stepZoom(current: Transform, direction: 1 | -1, picture: Size, stage: Size): Transform {
  const next = direction > 0 ? current.scale * ZOOM.step : current.scale / ZOOM.step;
  return zoomAt(current, next, { x: 0, y: 0 }, picture, stage);
}

/** How much a wheel turn zooms. A trackpad pinch arrives as a wheel with ctrlKey and small deltas,
 * so it is made more sensitive to feel like the fingers' own distance. */
export function wheelScaleFactor(deltaY: number, deltaMode: number, ctrlKey: boolean): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const clamped = Math.max(-120, Math.min(120, pixels));
  return Math.exp(-clamped * (ctrlKey ? 0.01 : 0.002));
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** A press that moved less than `ZOOM.tapPx` is a tap, not a drag. */
export function isTap(start: Point, end: Point): boolean {
  return distance(start, end) < ZOOM.tapPx;
}

/** A client point relative to the centre of a rectangle. */
export function fromCentre(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }): Point {
  return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
}

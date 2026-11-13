import { describe, expect, it } from 'vitest';
import {
  REST, ZOOM, clampPan, clampScale, fitSize, footprint, isSideways, isTap, isZoomed, stepZoom, toggleZoom, wheelScaleFactor, zoomAt,
} from '@/features/media/viewer/panZoomMath';

const stage = { width: 800, height: 600 };
const picture = { width: 800, height: 600 };

describe('panZoomMath', () => {
  it('keeps the scale between 1× and 5×', () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(9)).toBe(5);
    expect(clampScale(2)).toBe(2);
  });

  it('never pans a picture at rest, and keeps a zoomed one covering the stage', () => {
    expect(clampPan({ x: 50, y: -40 }, 1, picture, stage)).toEqual({ x: 0, y: 0 });
    // at 2× the picture is 1600×1200: 400 px of overflow on each side horizontally, 300 vertically
    expect(clampPan({ x: 1000, y: -1000 }, 2, picture, stage)).toEqual({ x: 400, y: -300 });
    expect(clampPan({ x: 120, y: 80 }, 2, picture, stage)).toEqual({ x: 120, y: 80 });
  });

  it('keeps a dimension smaller than the stage centred', () => {
    const tall = { width: 200, height: 600 };
    // 2× makes it 400 wide: still narrower than the stage, so no horizontal pan at all
    expect(clampPan({ x: 150, y: 0 }, 2, tall, stage).x).toBe(0);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const anchor = { x: 200, y: -100 };
    const next = zoomAt(REST, 2, anchor, picture, stage);
    // the spot under the anchor in picture space is (anchor - translation) / scale, before and after
    expect((anchor.x - next.x) / next.scale).toBeCloseTo(anchor.x / 1);
    expect((anchor.y - next.y) / next.scale).toBeCloseTo(anchor.y / 1);
  });

  it('clamps an anchored zoom near the edge instead of showing past it', () => {
    const next = zoomAt(REST, 5, { x: -399, y: 0 }, picture, stage);
    const max = (picture.width * 5 - stage.width) / 2;
    expect(next.x).toBeLessThanOrEqual(max);
    expect(next.x).toBeGreaterThanOrEqual(-max);
  });

  it('zooming back to 1× returns to rest, wherever it was panned', () => {
    expect(zoomAt({ scale: 3, x: 200, y: 100 }, 0.5, { x: 0, y: 0 }, picture, stage)).toEqual(REST);
  });

  it('steps by 1.25× and toggles to 2.5× and back', () => {
    expect(stepZoom(REST, 1, picture, stage).scale).toBeCloseTo(ZOOM.step);
    expect(stepZoom({ scale: 2, x: 0, y: 0 }, -1, picture, stage).scale).toBeCloseTo(2 / ZOOM.step);
    const zoomed = toggleZoom(REST, { x: 0, y: 0 }, picture, stage);
    expect(zoomed.scale).toBe(ZOOM.toggle);
    expect(isZoomed(zoomed)).toBe(true);
    expect(toggleZoom(zoomed, { x: 0, y: 0 }, picture, stage)).toEqual(REST);
  });

  it('turns a wheel down into zooming out and up into zooming in, a pinch more sensitively', () => {
    expect(wheelScaleFactor(100, 0, false)).toBeLessThan(1);
    expect(wheelScaleFactor(-100, 0, false)).toBeGreaterThan(1);
    expect(wheelScaleFactor(-10, 0, true)).toBeGreaterThan(wheelScaleFactor(-10, 0, false));
  });

  it('fits a turned picture whole, and never enlarges a small one', () => {
    expect(isSideways(90)).toBe(true);
    expect(isSideways(-270)).toBe(true);
    expect(isSideways(180)).toBe(false);
    const wide = { width: 1600, height: 400 };
    const laidOut = fitSize(wide, stage, 90);
    const turned = footprint(laidOut, 90);
    expect(turned.width).toBeLessThanOrEqual(stage.width);
    expect(turned.height).toBeLessThanOrEqual(stage.height);
    expect(fitSize({ width: 100, height: 50 }, stage)).toEqual({ width: 100, height: 50 });
  });

  it('counts a press that moved under 20 px as a tap', () => {
    expect(isTap({ x: 0, y: 0 }, { x: 12, y: 12 })).toBe(true);
    expect(isTap({ x: 0, y: 0 }, { x: 20, y: 0 })).toBe(false);
  });
});

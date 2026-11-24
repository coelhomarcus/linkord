import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCREEN } from '@game/layout';
import { averageZones, glowAt, IDLE_GLOW, SAMPLE_INTERVAL, ScreenGlow, smoothGlow, type Rgb } from '@/features/playground/engine/screenGlow';

/** RGBA pixels `width` × `height`, each the colour `paint(x, y)` gives */
function pixels(width: number, height: number, paint: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data.set([...paint(x, y), 255], (y * width + x) * 4);
    }
  }
  return data;
}

describe('averageZones', () => {
  it('averages each third of the picture apart, left to right', () => {
    const zones = averageZones(pixels(12, 3, (x) => (x < 4 ? [255, 0, 0] : x < 8 ? [0, 255, 0] : [0, 0, 255])), 12, 3);
    expect(zones).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  });

  it('averages as light, not as sRGB numbers', () => {
    // half black and half white is half the light: brighter than sRGB 128
    const [zone] = averageZones(pixels(2, 1, (x) => (x ? [255, 255, 255] : [0, 0, 0])), 2, 1, 1);
    expect(zone![0]).toBeCloseTo(0.5);
    const [grey] = averageZones(pixels(1, 1, () => [128, 128, 128]), 1, 1, 1);
    expect(grey![0]).toBeCloseTo(0.216, 2);
  });

  it('gives a picture narrower than the zones a colour in each', () => {
    const zones = averageZones(pixels(16, 9, () => [255, 255, 255]), 16, 9);
    expect(zones).toHaveLength(3);
    for (const zone of zones) expect(zone).toEqual([1, 1, 1]);
  });
});

describe('smoothGlow', () => {
  const black = (): Rgb[] => [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const white: Rgb[] = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];

  it('moves toward the target and settles on it', () => {
    const current = black();
    smoothGlow(current, white, 1 / 60);
    expect(current[0]![0]).toBeGreaterThan(0);
    expect(current[0]![0]).toBeLessThan(0.1);
    for (let i = 0; i < 300; i++) smoothGlow(current, white, 1 / 60);
    expect(current[1]![1]).toBeCloseTo(1, 3);
  });

  it('never swings a channel faster than about 1.5 a second, however long a frame', () => {
    const current = black();
    smoothGlow(current, white, 0.1);
    expect(current[0]![0]).toBeLessThanOrEqual(0.15 + 1e-9);
  });

  it('turns a picture flashing ten times a second into a flicker of a few percent', () => {
    const current: Rgb[] = [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]];
    let low = 1;
    let high = 0;
    for (let frame = 0; frame < 600; frame++) {
      // black and white swap every 3 frames at 60 fps
      const target = Math.floor(frame / 3) % 2 ? white : black();
      smoothGlow(current, target, 1 / 60);
      if (frame > 300) {
        low = Math.min(low, current[0]![0]);
        high = Math.max(high, current[0]![0]);
      }
    }
    expect(high - low).toBeLessThan(0.1);
  });

  it('follows more slowly with reduced motion', () => {
    const normal = black();
    const reduced = black();
    for (let i = 0; i < 30; i++) {
      smoothGlow(normal, white, 1 / 60);
      smoothGlow(reduced, white, 1 / 60, true);
    }
    expect(reduced[0]![0]).toBeLessThan(normal[0]![0] / 2);
  });
});

describe('glowAt', () => {
  const zones: Rgb[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  it('is the centre zone in the middle and blends toward each side', () => {
    expect(glowAt(zones, SCREEN.x, [0, 0, 0])).toEqual([0, 1, 0]);
    expect(glowAt(zones, SCREEN.x - SCREEN.width / 6, [0, 0, 0])).toEqual([0.5, 0.5, 0]);
    expect(glowAt(zones, SCREEN.x + SCREEN.width / 3, [0, 0, 0])).toEqual([0, 0, 1]);
  });

  it('keeps the side zone past the end of the screen', () => {
    expect(glowAt(zones, SCREEN.x - 50, [0, 0, 0])).toEqual([1, 0, 0]);
  });
});

describe('ScreenGlow', () => {
  let drawImage: ReturnType<typeof vi.fn>;
  let reads = 0;

  beforeEach(() => {
    reads = 0;
    drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({
      drawImage,
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        reads++;
        return { data: pixels(w, h, () => [255, 0, 0]) };
      },
    })) as unknown as HTMLCanvasElement['getContext']);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** a video element that says it has a frame to show */
  function playing(): HTMLVideoElement {
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { value: HTMLMediaElement.HAVE_ENOUGH_DATA });
    Object.defineProperty(video, 'videoWidth', { value: 1280 });
    return video;
  }

  it('rests on the idle glow with nothing on the screen, and reads nothing', () => {
    const glow = new ScreenGlow();
    glow.update(1);
    expect(glow.zones[1]).toEqual(IDLE_GLOW);
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('reads the picture at most ten times a second and turns toward its colour', () => {
    const glow = new ScreenGlow();
    glow.setVideo(playing());
    for (let i = 0; i < 60; i++) glow.update(1 / 60);
    expect(reads).toBeLessThanOrEqual(Math.ceil(1 / SAMPLE_INTERVAL) + 1);
    expect(reads).toBeGreaterThanOrEqual(9);
    const [r, g] = glow.zones[1]!;
    expect(r).toBeGreaterThan(0.5);
    expect(g).toBeLessThan(IDLE_GLOW[1]);
  });

  it('fades back to the idle glow when the stream stops', () => {
    const glow = new ScreenGlow();
    glow.setVideo(playing());
    for (let i = 0; i < 120; i++) glow.update(1 / 60);
    glow.setVideo(null);
    for (let i = 0; i < 600; i++) glow.update(1 / 60);
    glow.zones.forEach((zone) => zone.forEach((c, i) => expect(c).toBeCloseTo(IDLE_GLOW[i]!, 3)));
  });
});

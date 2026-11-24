import { SCREEN } from '@game/layout';

// The colour of the big screen's light: what is on it, averaged in three zones
// (left, centre, right) so the plaza takes a gradient along it, and smoothed so
// it follows the picture without flashing. Where the light reaches is game/
// light.ts's ScreenLight; this is only its colour, a few uniforms, so a change
// of picture never rebuilds a chunk.
//
// Flashing content must not flash the whole view: every channel moves toward
// the picture's colour gradually (SMOOTHING) and never faster than a full swing
// in about 0.7 s (MAX_RATE), under three a second however the picture flickers.
// With reduced motion it follows more slowly still.

/** A light's colour, linear, 0..1 a channel. */
export type Rgb = [number, number, number];

/** left, centre and right */
export const GLOW_ZONES = 3;
/** the size the picture is drawn at to be averaged: a few hundred pixels, read in microseconds */
export const SAMPLE_WIDTH = 16;
export const SAMPLE_HEIGHT = 9;
/** how often the picture is read (s): 10 times a second */
export const SAMPLE_INTERVAL = 0.1;

/** time constant (s) of the easing toward the picture's colour */
const SMOOTHING = { normal: 0.25, reduced: 1 } as const;
/** the most a channel moves in a second (0..1) */
const MAX_RATE = { normal: 1.5, reduced: 0.4 } as const;

/** The idle card's dim, neutral glow; a stream fades from and back to it. */
export const IDLE_GLOW: Rgb = [0.05, 0.05, 0.055];

/** An sRGB byte as linear light. */
function linear(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
const LINEAR = Float32Array.from({ length: 256 }, (_, i) => linear(i));

/** The picture's average colour (linear) in each of `zones` vertical bands, left to right, from RGBA pixels
 * (getImageData's). Light adds up, so pixels are averaged as light, not as sRGB numbers. */
export function averageZones(pixels: ArrayLike<number>, width: number, height: number, zones = GLOW_ZONES): Rgb[] {
  const sums = Array.from({ length: zones }, () => [0, 0, 0, 0]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const sum = sums[Math.min(zones - 1, Math.floor((x * zones) / width))]!;
      sum[0]! += LINEAR[pixels[i]!]!;
      sum[1]! += LINEAR[pixels[i + 1]!]!;
      sum[2]! += LINEAR[pixels[i + 2]!]!;
      sum[3]!++;
    }
  }
  return sums.map(([r, g, b, n]) => (n ? [r! / n, g! / n, b! / n] : [0, 0, 0]));
}

/** Moves `current` toward `target` over `dt` seconds, eased and rate-limited (see above); in place. */
export function smoothGlow(current: Rgb[], target: readonly Rgb[], dt: number, reducedMotion = false): void {
  const kind = reducedMotion ? 'reduced' : 'normal';
  const ease = 1 - Math.exp(-dt / SMOOTHING[kind]);
  const limit = MAX_RATE[kind] * dt;
  current.forEach((rgb, zone) => {
    const goal = target[zone] ?? target[target.length - 1]!;
    for (let c = 0; c < 3; c++) {
      const step = (goal[c]! - rgb[c]!) * ease;
      rgb[c] = rgb[c]! + Math.max(-limit, Math.min(limit, step));
    }
  });
}

/** The glow's colour at world x: the zones' colours along the screen, blended between their middles
 * (the block shader in voxelWorld.ts does the same). */
export function glowAt(zones: readonly Rgb[], x: number, out: Rgb): Rgb {
  const t = Math.max(-1, Math.min(1, (x - SCREEN.x) / (SCREEN.width / 3)));
  const [left, centre, right] = zones as [Rgb, Rgb, Rgb];
  const side = t < 0 ? left : right;
  const k = Math.abs(t);
  for (let c = 0; c < 3; c++) out[c] = centre[c]! + (side[c]! - centre[c]!) * k;
  return out;
}

const idle = (): Rgb[] => Array.from({ length: GLOW_ZONES }, () => [...IDLE_GLOW] as Rgb);

/** Reads the screen's picture now and then and keeps its smoothed colour. */
export class ScreenGlow {
  /** the colour now, by zone */
  readonly zones: Rgb[] = idle();
  private target: Rgb[] = idle();
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private context: CanvasRenderingContext2D | null = null;
  private sinceSample = SAMPLE_INTERVAL;
  private reducedMotion = false;
  private readonly motionQuery: MediaQueryList | null;

  constructor() {
    this.motionQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    this.reducedMotion = this.motionQuery?.matches ?? false;
    this.motionQuery?.addEventListener('change', this.onMotionChange);
  }

  private onMotionChange = (event: MediaQueryListEvent): void => {
    this.reducedMotion = event.matches;
  };

  /** What the screen shows: a stream, or nothing (the idle card). */
  setVideo(video: HTMLVideoElement | null): void {
    this.video = video;
    this.sinceSample = SAMPLE_INTERVAL;
    if (!video) this.target = idle();
  }

  /** Reads the picture when it is time, and moves the colour toward it. */
  update(dt: number): void {
    this.sinceSample += dt;
    if (this.video && this.sinceSample >= SAMPLE_INTERVAL) {
      this.sinceSample = 0;
      this.sample(this.video);
    }
    smoothGlow(this.zones, this.target, dt, this.reducedMotion);
  }

  private sample(video: HTMLVideoElement): void {
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) return;
    if (!this.context) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = SAMPLE_WIDTH;
      this.canvas.height = SAMPLE_HEIGHT;
      this.context = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!this.context) return;
    }
    try {
      this.context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
      this.target = averageZones(this.context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT).data, SAMPLE_WIDTH, SAMPLE_HEIGHT);
    } catch {
      // a picture the page may not read: the idle glow
      this.target = idle();
    }
  }

  dispose(): void {
    this.motionQuery?.removeEventListener('change', this.onMotionChange);
    this.video = null;
    this.context = null;
    this.canvas = null;
  }
}

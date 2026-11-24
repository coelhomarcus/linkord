// The de facto skin format of blocky-avatar games: a 64×64 PNG (64×32 for old
// ones) where every body part is a box unwrapped onto the image, with a second,
// slightly larger box around it (the "outer layer": hat, jacket, sleeves, pants)
// whose transparent pixels let the inner one show through. Supporting it lets
// people bring the skins they already have.
//
// A box at (u, v) that is w wide, h tall and d deep unwraps as
//
//          u   u+d   u+d+w  u+2d+w  u+2d+2w
//   v           [ top ] [bottom]
//   v+d  [right][front] [ left ] [ back ]
//   v+d+h
//
// where right and left are the character's own (seen from the front, its right
// is on the viewer's left).

export const SKIN_WIDTH = 64;
export const SKIN_HEIGHT = 64;
export const LEGACY_SKIN_HEIGHT = 32;

export type PartName = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';

export interface BoxLayout {
  /** where the inner box starts on the image */
  inner: [number, number];
  /** where the outer layer starts */
  outer: [number, number];
  /** size in skin pixels: width (x), height (y), depth (z) */
  size: [number, number, number];
}

export function partLayout(part: PartName, slim: boolean): BoxLayout {
  const arm = slim ? 3 : 4;
  switch (part) {
    case 'head': return { inner: [0, 0], outer: [32, 0], size: [8, 8, 8] };
    case 'body': return { inner: [16, 16], outer: [16, 32], size: [8, 12, 4] };
    case 'rightArm': return { inner: [40, 16], outer: [40, 32], size: [arm, 12, 4] };
    case 'leftArm': return { inner: [32, 48], outer: [48, 48], size: [arm, 12, 4] };
    case 'rightLeg': return { inner: [0, 16], outer: [0, 32], size: [4, 12, 4] };
    case 'leftLeg': return { inner: [16, 48], outer: [0, 48], size: [4, 12, 4] };
  }
}

export interface Rect { x: number; y: number; w: number; h: number }

/** The six faces of a box on the image, in three.js BoxGeometry's face order
 * (+x, -x, +y, -y, +z, -z) for a model that faces +z: +x is its left side. */
export function boxFaces(u: number, v: number, [w, h, d]: [number, number, number]): Rect[] {
  return [
    { x: u + d + w, y: v + d, w: d, h },     // +x: left side
    { x: u, y: v + d, w: d, h },             // -x: right side
    { x: u + d, y: v, w, h: d },             // +y: top
    { x: u + d + w, y: v, w, h: d },         // -y: bottom
    { x: u + d, y: v + d, w, h },            // +z: front
    { x: u + 2 * d + w, y: v + d, w, h },    // -z: back
  ];
}

const alphaAt = (pixels: Uint8ClampedArray, x: number, y: number) => pixels[(y * SKIN_WIDTH + x) * 4 + 3]!;

function allClear(pixels: Uint8ClampedArray, x0: number, y0: number, w: number, h: number): boolean {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (alphaAt(pixels, x, y) !== 0) return false;
  return true;
}

/** A slim (3-pixel arm) skin leaves the fourth column of the right arm's box
 * empty: the end of its top/bottom strip and the end of its back face. */
export function isSlimSkin(pixels: Uint8ClampedArray): boolean {
  return allClear(pixels, 50, 16, 2, 4) && allClear(pixels, 54, 20, 2, 12);
}

/** Copies a w×h area, flipped left to right. */
function copyMirrored(source: Uint8ClampedArray, target: Uint8ClampedArray, sx: number, sy: number, tx: number, ty: number, w: number, h: number): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const from = ((sy + y) * SKIN_WIDTH + (sx + w - 1 - x)) * 4;
      const to = ((ty + y) * SKIN_WIDTH + (tx + x)) * 4;
      for (let c = 0; c < 4; c++) target[to + c] = source[from + c]!;
    }
  }
}

/** A 64×32 skin as a 64×64 one. Old skins had one arm and one leg, worn on
 * both sides: the left ones are the right ones mirrored, each face flipped and
 * the two side faces swapped, so the model needs only one layout. */
export function upgradeLegacySkin(legacy: Uint8ClampedArray): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4);
  pixels.set(legacy);
  for (const [[sx, sy], [tx, ty]] of [[[0, 16], [16, 48]], [[40, 16], [32, 48]]] as const) {
    const faces = boxFaces(sx, sy, [4, 12, 4]);
    const target = boxFaces(tx, ty, [4, 12, 4]);
    // top, bottom, front and back flip in place; the outer sides trade places
    const pairs: [number, number][] = [[2, 2], [3, 3], [4, 4], [5, 5], [0, 1], [1, 0]];
    for (const [from, to] of pairs) {
      const f = faces[from]!;
      const t = target[to]!;
      copyMirrored(legacy, pixels, f.x, f.y, t.x, t.y, f.w, f.h);
    }
  }
  // an old skin with no transparency at all over its hat area meant "no hat":
  // drawn as is, it would wrap the head in a solid box
  if (isOpaque(pixels, 32, 0, 32, 16)) for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) pixels[(y * SKIN_WIDTH + x) * 4 + 3] = 0;
  return pixels;
}

function isOpaque(pixels: Uint8ClampedArray, x0: number, y0: number, w: number, h: number): boolean {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (alphaAt(pixels, x, y) !== 255) return false;
  return true;
}

import { hashString } from '@game/layout';
import { boxFaces, partLayout, SKIN_HEIGHT, SKIN_WIDTH } from './skinFormat';
import type { PartName } from './skinFormat';
import type { Skin } from './skins';

// Linkord's own default skins, painted in code: a skin tone, hair, a shirt,
// trousers and shoes picked from small palettes by the account id, so everyone
// who has not chosen a skin still looks like themselves every time.

type Rgb = [number, number, number];

const hex = (value: number): Rgb => [(value >> 16) & 255, (value >> 8) & 255, value & 255];

const SKIN_TONES = [0xf2c7a5, 0xe0a982, 0xc68863, 0x9c6644, 0x6f4630].map(hex);
const HAIR = [0x2b1d14, 0x5a3825, 0xa8692e, 0xd9b26f, 0x1c1c22, 0xb8442f, 0x6d6e73].map(hex);
const SHIRTS = [0xd9534f, 0xf0ad4e, 0x5cb85c, 0x8e6bd8, 0xe36fa8, 0x3a3f4b, 0xf2f2f2, 0x2f8f9d].map(hex);
const TROUSERS = [0x3b3f58, 0x5b4636, 0x2d2d33, 0x6b7a3a, 0x7d6b5d].map(hex);
const SHOES = [0x2a2420, 0x4a4a52, 0x6e3b26].map(hex);
const EYES = [0x3f6ea8, 0x4b3a2a, 0x3d7a4a, 0x2a2a2a].map(hex);

/** Shades a colour by a factor, so flat areas get a little texture. */
const shade = ([r, g, b]: Rgb, f: number): Rgb => [Math.min(255, r * f), Math.min(255, g * f), Math.min(255, b * f)];

function painter(pixels: Uint8ClampedArray, seed: number) {
  let state = seed || 1;
  const rand = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };
  return {
    rand,
    set(x: number, y: number, color: Rgb, alpha = 255) {
      const i = (y * SKIN_WIDTH + x) * 4;
      pixels[i] = color[0]; pixels[i + 1] = color[1]; pixels[i + 2] = color[2]; pixels[i + 3] = alpha;
    },
  };
}

/** A 64×64 RGBA skin for this account. */
export function defaultSkinPixels(userId: string): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4);
  const seed = hashString(userId);
  const pick = <T,>(list: T[], salt: number) => list[(seed >>> salt) % list.length]!;
  const skin = pick(SKIN_TONES, 0);
  const hair = pick(HAIR, 3);
  const shirt = pick(SHIRTS, 7);
  const trousers = pick(TROUSERS, 11);
  const shoes = pick(SHOES, 15);
  const eyes = pick(EYES, 19);
  const longHair = ((seed >>> 23) & 1) === 1;
  const p = painter(pixels, seed);
  // a little noise in every flat colour, like hand-painted pixels
  const fill = (part: PartName, color: (face: number, x: number, y: number, w: number, h: number) => Rgb) => {
    const { inner, size } = partLayout(part, false);
    boxFaces(inner[0], inner[1], size).forEach((r, face) => {
      for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) p.set(r.x + x, r.y + y, shade(color(face, x, y, r.w, r.h), 0.94 + p.rand() * 0.1));
    });
  };

  // head: hair on top and at the back, a fringe and sides on the face
  fill('head', (face, x, y) => {
    if (face === 2 || face === 5) return hair;
    if (face === 3) return skin;
    const sideHair = longHair ? y < 6 : y < 3;
    if (face === 0 || face === 1) return sideHair || (face === 0 ? x > 5 : x < 2) && y < 5 ? hair : skin;
    if (y < 2 || (y === 2 && (x === 0 || x === 7))) return hair;
    if (longHair && (x === 0 || x === 7) && y < 7) return hair;
    return skin;
  });
  // the face itself, drawn over the head's front (8..15, 8..15)
  const white: Rgb = [245, 245, 245];
  for (const [x, colour] of [[9, white], [10, eyes], [13, eyes], [14, white]] as const) p.set(8 + x - 8, 12, colour);
  p.set(11, 14, shade(skin, 0.75)); p.set(12, 14, shade(skin, 0.75));
  p.set(11, 13, shade(skin, 0.88)); p.set(12, 13, shade(skin, 0.88));

  fill('body', (face, x, y, w) => {
    if (face === 2) return shirt;
    if (face === 3) return trousers;
    if (face === 4 && y === 0 && x >= w / 2 - 1 && x <= w / 2) return skin; // neckline
    return y >= 10 ? shade(trousers, 0.9) : shirt;
  });
  for (const arm of ['rightArm', 'leftArm'] as const) {
    fill(arm, (face, _x, y) => (face === 3 || y >= 6 ? skin : shirt));
  }
  for (const leg of ['rightLeg', 'leftLeg'] as const) {
    fill(leg, (face, _x, y) => (face === 3 || y >= 10 ? shoes : trousers));
  }
  return pixels;
}

const cache = new Map<string, Skin>();

/** This account's default skin, painted once per account. */
export function defaultSkin(userId: string): Skin {
  let skin = cache.get(userId);
  if (!skin) {
    skin = { pixels: defaultSkinPixels(userId), slim: false };
    cache.set(userId, skin);
  }
  return skin;
}

import { describe, expect, it } from 'vitest';
import { boxFaces, isSlimSkin, partLayout, SKIN_WIDTH, upgradeLegacySkin } from '@/features/playground/skins/skinFormat';

const pixelsOf = (height: number) => new Uint8ClampedArray(SKIN_WIDTH * height * 4);
const paint = (pixels: Uint8ClampedArray, x: number, y: number, rgba: [number, number, number, number]) => pixels.set(rgba, (y * SKIN_WIDTH + x) * 4);
const read = (pixels: Uint8ClampedArray, x: number, y: number) => [...pixels.slice((y * SKIN_WIDTH + x) * 4, (y * SKIN_WIDTH + x) * 4 + 4)];

function fillOpaque(pixels: Uint8ClampedArray, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) paint(pixels, x, y, [10, 20, 30, 255]);
}

describe('skin layout', () => {
  it('unwraps the head where every skin keeps it: face at (8, 8), top at (8, 0)', () => {
    const [left, right, top, bottom, front, back] = boxFaces(0, 0, partLayout('head', false).size);
    expect(front).toEqual({ x: 8, y: 8, w: 8, h: 8 });
    expect(top).toEqual({ x: 8, y: 0, w: 8, h: 8 });
    expect(bottom).toEqual({ x: 16, y: 0, w: 8, h: 8 });
    expect(right).toEqual({ x: 0, y: 8, w: 8, h: 8 });
    expect(left).toEqual({ x: 16, y: 8, w: 8, h: 8 });
    expect(back).toEqual({ x: 24, y: 8, w: 8, h: 8 });
  });

  it('narrows only the arms on a slim skin', () => {
    expect(partLayout('rightArm', true).size).toEqual([3, 12, 4]);
    expect(partLayout('leftArm', true).size).toEqual([3, 12, 4]);
    expect(partLayout('rightLeg', true).size).toEqual([4, 12, 4]);
  });
});

describe('isSlimSkin', () => {
  it('reads an empty fourth arm column as slim, a painted one as classic', () => {
    const paintArm = (slim: boolean) => {
      const pixels = pixelsOf(64);
      const { inner, size } = partLayout('rightArm', slim);
      for (const face of boxFaces(inner[0], inner[1], size)) fillOpaque(pixels, face.x, face.y, face.w, face.h);
      return pixels;
    };
    expect(isSlimSkin(paintArm(true))).toBe(true);
    expect(isSlimSkin(paintArm(false))).toBe(false);
  });
});

describe('upgradeLegacySkin', () => {
  it('keeps the top half and gives the left leg the right one, mirrored', () => {
    const legacy = pixelsOf(32);
    paint(legacy, 8, 8, [1, 2, 3, 255]); // the face
    // the right leg's front is (4, 20) 4 wide: its leftmost pixel
    paint(legacy, 4, 20, [200, 0, 0, 255]);
    const pixels = upgradeLegacySkin(legacy);
    expect(read(pixels, 8, 8)).toEqual([1, 2, 3, 255]);
    // the left leg's front is (20, 52): mirrored, that pixel lands on its rightmost column
    expect(read(pixels, 23, 52)).toEqual([200, 0, 0, 255]);
    expect(read(pixels, 20, 52)).toEqual([0, 0, 0, 0]);
  });

  it('swaps the outer sides of the copied limb', () => {
    const legacy = pixelsOf(32);
    // the right arm's right (outer) side starts at (40, 20)
    paint(legacy, 40, 20, [0, 200, 0, 255]);
    const pixels = upgradeLegacySkin(legacy);
    // on the left arm, the outer side is its left side, at (32 + 4 + 4, 52) = (40, 52), 4 wide
    expect(read(pixels, 43, 52)).toEqual([0, 200, 0, 255]);
  });

  it('clears an old skin\'s solid hat area, which meant "no hat"', () => {
    const legacy = pixelsOf(32);
    fillOpaque(legacy, 32, 0, 32, 16);
    expect(read(upgradeLegacySkin(legacy), 40, 8)[3]).toBe(0);
  });
});

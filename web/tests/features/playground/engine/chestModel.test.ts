import { beforeAll, describe, expect, it, vi } from 'vitest';
import { CHEST_FACES, chestSidePixels } from '@/features/playground/engine/chestModel';

// jsdom has no ImageData: what the model reads of it is its size and its pixels
beforeAll(() => {
  vi.stubGlobal('ImageData', class {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  });
});

/** A 64×64 texture with every pixel opaque, so a see-through pixel of a side means nothing covered it. */
function solidTexture(): ImageData {
  const texture = new ImageData(64, 64);
  texture.data.fill(255);
  return texture;
}

describe('chestModel', () => {
  it('fills the whole cell with the body and lid, with only the latch standing out of the front', () => {
    const corners = CHEST_FACES.flatMap((face) => face.corners);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    const zs = corners.map(([, , z]) => z);
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(16);
    expect(Math.min(...ys)).toBeCloseTo(0);
    expect(Math.max(...ys)).toBeCloseTo(16);
    expect(Math.min(...zs)).toBeCloseTo(0);
    // the latch keeps its pixel of depth in front of the lid
    expect(Math.max(...zs)).toBeCloseTo(17);
  });

  it('gives the item cube sides with no see-through rim', () => {
    for (const view of ['top', 'front', 'side'] as const) {
      const side = chestSidePixels(solidTexture(), view);
      const alphas = Array.from({ length: 256 }, (_, i) => side.data[i * 4 + 3]);
      expect(alphas.every((alpha) => alpha === 255), view).toBe(true);
    }
  });
});

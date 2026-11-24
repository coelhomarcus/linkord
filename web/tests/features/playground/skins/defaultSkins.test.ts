import { describe, expect, it } from 'vitest';
import { defaultSkin, defaultSkinPixels } from '@/features/playground/skins/defaultSkins';
import { boxFaces, partLayout, SKIN_WIDTH } from '@/features/playground/skins/skinFormat';
import type { PartName } from '@/features/playground/skins/skinFormat';

const alpha = (pixels: Uint8ClampedArray, x: number, y: number) => pixels[(y * SKIN_WIDTH + x) * 4 + 3];

describe('default skins', () => {
  it('paints the same skin for the same account, and different ones across accounts', () => {
    expect(defaultSkinPixels('u-1')).toEqual(defaultSkinPixels('u-1'));
    const looks = new Set(Array.from({ length: 30 }, (_, i) => defaultSkinPixels(`u-${i}`).join(',')));
    expect(looks.size).toBeGreaterThan(20);
    expect(defaultSkin('u-1')).toBe(defaultSkin('u-1'));
  });

  it('fills every face of every part and leaves the outer layer empty', () => {
    const pixels = defaultSkinPixels('u-7');
    for (const part of ['head', 'body', 'rightArm', 'leftArm', 'rightLeg', 'leftLeg'] as PartName[]) {
      const layout = partLayout(part, false);
      for (const face of boxFaces(layout.inner[0], layout.inner[1], layout.size)) {
        for (let y = face.y; y < face.y + face.h; y++) for (let x = face.x; x < face.x + face.w; x++) expect(alpha(pixels, x, y)).toBe(255);
      }
      const outer = boxFaces(layout.outer[0], layout.outer[1], layout.size)[4]!;
      expect(alpha(pixels, outer.x, outer.y)).toBe(0);
    }
  });
});

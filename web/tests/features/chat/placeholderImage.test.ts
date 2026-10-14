import { describe, expect, it } from 'vitest';
import { rgbaToThumbHash } from 'thumbhash';
import { placeholderDataUrl } from '@/features/chat/placeholderImage';

const solid = (r: number, g: number, b: number, a = 255) => {
  const w = 8, h = 8, rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) rgba.set([r, g, b, a], i * 4);
  return btoa(String.fromCharCode(...rgbaToThumbHash(w, h, rgba)));
};

describe('placeholderDataUrl', () => {
  it('turns a ThumbHash into an image the box can paint', () => {
    expect(placeholderDataUrl(solid(220, 40, 40))).toMatch(/^data:image\/png;base64,/);
  });

  it('is null when there is no placeholder, or it is not one', () => {
    expect(placeholderDataUrl(undefined)).toBeNull();
    expect(placeholderDataUrl('')).toBeNull();
    expect(placeholderDataUrl('%%% not base64 %%%')).toBeNull();
    expect(placeholderDataUrl('AAAA')).toBeNull();
  });

  it('decodes each placeholder once', () => {
    const hash = solid(10, 120, 200);
    expect(placeholderDataUrl(hash)).toBe(placeholderDataUrl(hash));
  });
});

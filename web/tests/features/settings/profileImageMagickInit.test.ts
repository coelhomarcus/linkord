import { describe, expect, it, vi } from 'vitest';

const initializeImageMagick = vi.hoisted(() => vi.fn());

vi.mock('@imagemagick/magick-wasm', () => ({
  initializeImageMagick,
  ImageMagick: {},
  MagickFormat: {},
  MagickGeometry: class MagickGeometry {},
}));

describe('profile image processor init', () => {
  it('tries again after the wasm module fails to load', async () => {
    initializeImageMagick.mockReset();
    initializeImageMagick.mockRejectedValueOnce(new Error('wasm'));
    initializeImageMagick.mockResolvedValueOnce(undefined);
    const { initializeProfileImageMagick } = await import('@/features/settings/cropProfileImage');
    const bytes = new Uint8Array([1]);

    await expect(initializeProfileImageMagick(bytes)).rejects.toThrow();
    await expect(initializeProfileImageMagick(bytes)).resolves.toBeUndefined();
    expect(initializeImageMagick).toHaveBeenCalledTimes(2);
  });
});

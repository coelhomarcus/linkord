import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { ImageMagick, MagickColors, MagickFormat } from '@imagemagick/magick-wasm';
import { cropProfileImage, initializeProfileImageMagick, ProfileImageCropError } from '@/features/settings/cropProfileImage';

beforeAll(async () => {
  await initializeProfileImageMagick(
    new Uint8Array(await readFile('node_modules/@imagemagick/magick-wasm/dist/x86/magick.wasm')),
  );
}, 30_000);

function pngBytes(width: number, height: number): Uint8Array {
  return ImageMagick.read(MagickColors.Red, width, height, (image) => (
    image.write(MagickFormat.Png, (data) => data.slice())
  ));
}

/** Magick's JPEG writer drops the orientation tag, so the fixture carries its own EXIF. */
function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  const payload = new Uint8Array([
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
    0x49, 0x49, 0x2a, 0x00,
    0x08, 0x00, 0x00, 0x00,
    0x01, 0x00,
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, orientation, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  const app1 = new Uint8Array(4 + payload.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  const length = payload.length + 2;
  app1[2] = length >> 8;
  app1[3] = length & 0xff;
  app1.set(payload, 4);
  const out = new Uint8Array(jpeg.length + app1.length);
  out[0] = jpeg[0]!;
  out[1] = jpeg[1]!;
  out.set(app1, 2);
  out.set(jpeg.subarray(2), 2 + app1.length);
  return out;
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('cropProfileImage', () => {
  it('turns a still PNG into a JPEG of the cropped size', async () => {
    const blob = await cropProfileImage(pngBytes(8, 5), { x: 0, y: 0, width: 8, height: 5 }, 'image/png');
    expect(blob.type).toBe('image/jpeg');
    const again = await ImageMagick.read(new Uint8Array(await blob.arrayBuffer()), (image) => ({
      format: image.format,
      width: image.width,
      height: image.height,
    }));
    expect(again).toEqual({ format: MagickFormat.Jpeg, width: 8, height: 5 });
  });

  it('keeps an animated GIF animated after the crop', async () => {
    const gif = fromBase64(
      'R0lGODlhAgACAPcfMQAAACQAAEgAAGwAAJAAALQAANgAAPwAAAAkACQkAEgkAGwkAJAkALQkANgkAPwkAABIACRIAEhIAGxIAJBIALRIANhIAPxIAABsACRsAEhsAGxsAJBsALRsANhsAPxsAACQACSQAEiQAGyQAJCQALSQANiQAPyQAAC0ACS0AEi0AGyQAJC0ALSQANi0APy0AADYACTYAEjYAGzYAJDYALTYANjYAPzYAAD8ACT8AEj8AGz8AJD8ALT8ANj8APz8AAAAVSQAVUgAVWwAVZAAVbQAVdgAVfwAVQAkVSQkVUgkVWwkVZAkVbQkVdgkVfwkVQBIVSRIVUhIVWxIVZBIVbRIVdhIVfxIVQBsVSRsVUhsVWxsVZBsVbRsVdhsVfxsVQCQVSSQVUiQVWyQVZCQVbSQVdiQVfyQVQC0VSS0VUi0VWy0VZC0VbS0Vdi0Vfy0VQDYVSTYVUjYVWzYVZDYVbTYVdjYVfzYVQD8VST8VUj8VWz8VZD8VbT8Vdj8Vfz8VQAAqiQAqkgAqmwAqpAAqrQAqtgAqvwAqgAkqiQkqkgkqmwkqpAkqrQkqtgkqvwkqgBIqiRIqkhIqmxIqpBIqrRIqthIqvxIqgBsqiRsqkhsqmxsqpBsqrRsqthsqvxsqgCQqiSQqkiQqmyQqpCQqrSQqtiQqvyQqgC0qiS0qki0qmy0qpC0qrS0qti0qvy0qgDYqiTYqkjYqmzYqpDYqrTYqtjYqvzYqgD8qiT8qkj8qmz8qpDYqrTYqtjYqvzYqgAA/yQA/0gA/2wA/5AA/7QA/9gA//wA/wAk/yQk/0gk/2wk/5Ak/7Qk/9gk//wk/wBI/yRI/0hI/2xI/5BI/7RI/9hI//xI/wBs/yRs/0hs/2xs/5Bs/7Rs/9hs//xs/wCQ/ySQ/0iQ/2yQ/5CQ/7SQ/9iQ//yQ/wC0/yS0/0i0/2yQ/5C0/7S0/9i0//y0/wDY/yTY/0jY/2zY/5DY/7TY/9jY//zY/wD8/yT8/0j8/2z8/5D8/7T8/9j8//z8/yH/C05FVFNDQVBFMi4wAwEAAAAh+QQEMgAfACwAAAAAAgACAAAIBgAPCDwQEAAh+QQFMgAAACwAAAAAAgACAAAIBgCBCQQWEAA7',
    );
    const blob = await cropProfileImage(gif, { x: 0, y: 0, width: 2, height: 2 }, 'image/gif');
    expect(blob.type).toBe('image/gif');
    const frames = await ImageMagick.readCollection(new Uint8Array(await blob.arrayBuffer()), (images) => images.length);
    expect(frames).toBe(2);
  });

  it('crops a JPEG using the orientation the browser shows', async () => {
    // Stored 6×10 with EXIF RightTop: a browser lays it out as 10×6, and the cropper reports that.
    const stored = withExifOrientation(ImageMagick.read(MagickColors.Red, 6, 10, (image) => (
      image.write(MagickFormat.Jpeg, (data) => data.slice())
    )), 6);
    const blob = await cropProfileImage(stored, { x: 0, y: 0, width: 10, height: 6 }, 'image/jpeg');
    const again = await ImageMagick.read(new Uint8Array(await blob.arrayBuffer()), (image) => ({
      width: image.width,
      height: image.height,
    }));
    expect(again).toEqual({ width: 10, height: 6 });
  });

  it('keeps a crop that rounding pushed one pixel past the edge', async () => {
    const blob = await cropProfileImage(pngBytes(8, 5), { x: 0, y: 0, width: 9, height: 5 }, 'image/png');
    const again = await ImageMagick.read(new Uint8Array(await blob.arrayBuffer()), (image) => ({
      width: image.width,
      height: image.height,
    }));
    expect(again).toEqual({ width: 8, height: 5 });
  });

  it('rejects a crop outside the image', async () => {
    await expect(cropProfileImage(pngBytes(8, 5), { x: 0, y: 0, width: 99, height: 99 }, 'image/png'))
      .rejects.toBeInstanceOf(ProfileImageCropError);
  });
});

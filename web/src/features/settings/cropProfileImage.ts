import { ImageMagick, initializeImageMagick, MagickFormat, MagickGeometry } from '@imagemagick/magick-wasm';
import magickWasmUrl from '@imagemagick/magick-wasm/magick.wasm?url';

import type { CropRect } from '@/state/RoomContext';

export const MAX_PROFILE_IMAGE_DIMENSION = 4096;

export class ProfileImageCropError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProfileImageCropError';
  }
}

let init: Promise<void> | null = null;

async function loadDefaultWasm(): Promise<Uint8Array> {
  const res = await fetch(magickWasmUrl);
  if (!res.ok) throw new ProfileImageCropError('Não foi possível carregar o processador de imagem.');
  return new Uint8Array(await res.arrayBuffer());
}

/** Loads the WASM once. Tests can pass the bytes so they don't have to
 * `fetch` the asset URL. */
export function initializeProfileImageMagick(wasmBytes?: Uint8Array): Promise<void> {
  init ??= (async () => {
    await initializeImageMagick(wasmBytes ?? await loadDefaultWasm());
  })();
  return init;
}

function roundedCrop(crop: CropRect): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.round(crop.x),
    top: Math.round(crop.y),
    width: Math.round(crop.width),
    height: Math.round(crop.height),
  };
}

function fitGeometry(): MagickGeometry {
  const geometry = new MagickGeometry(MAX_PROFILE_IMAGE_DIMENSION, MAX_PROFILE_IMAGE_DIMENSION);
  // ImageMagick `>` — shrink only when a side exceeds the ceiling.
  geometry.greater = true;
  return geometry;
}

/** Crops every frame (so a GIF/WebP stays animated) and encodes the way
 * the old sharp path did: animated WebP stays WebP, other animations stay
 * GIF, stills become JPEG. Output is capped at 4096 on the long side. */
export async function cropProfileImage(bytes: Uint8Array, crop: CropRect, mime: string): Promise<Blob> {
  await initializeProfileImageMagick();
  const rect = roundedCrop(crop);
  if (rect.width <= 0 || rect.height <= 0 || rect.left < 0 || rect.top < 0) {
    throw new ProfileImageCropError('Recorte inválido.');
  }

  try {
    return await ImageMagick.readCollection(bytes, (images) => {
      if (images.length === 0) throw new ProfileImageCropError('Não foi possível processar a imagem.');
      // GIF/WebP frames are often deltas against the previous one — coalesce
      // so the crop rect applies to a full picture on every page.
      if (images.length > 1) images.coalesce();

      const source = images[0]!;
      if (rect.left + rect.width > source.width || rect.top + rect.height > source.height) {
        throw new ProfileImageCropError('Recorte fora dos limites da imagem.');
      }

      const cropGeometry = new MagickGeometry(rect.left, rect.top, rect.width, rect.height);
      const resize = fitGeometry();
      for (const frame of images) {
        frame.crop(cropGeometry);
        frame.resetPage();
        frame.resize(resize);
      }

      const animated = images.length > 1;
      if (animated && mime === 'image/webp') {
        for (const frame of images) frame.quality = 90;
        return images.write(MagickFormat.WebP, (data) => new Blob([data.slice()], { type: 'image/webp' }));
      }
      if (animated) {
        return images.write(MagickFormat.Gif, (data) => new Blob([data.slice()], { type: 'image/gif' }));
      }
      const still = images[0]!;
      still.quality = 92;
      return still.write(MagickFormat.Jpeg, (data) => new Blob([data.slice()], { type: 'image/jpeg' }));
    });
  } catch (err) {
    if (err instanceof ProfileImageCropError) throw err;
    throw new ProfileImageCropError('Não foi possível processar a imagem.');
  }
}

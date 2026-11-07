import { ImageMagick, initializeImageMagick, MagickFormat, MagickGeometry } from '@imagemagick/magick-wasm';
import magickWasmUrl from '@imagemagick/magick-wasm/magick.wasm?url';

import type { CropRect } from '@/state/RoomContext';
import { i18n } from '@/shared/i18n/init';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'profile-image' });

const MAX_PROFILE_IMAGE_DIMENSION = 4096;
// react-easy-crop rounds the rect independently on each edge, so a crop
// that sits on the border can stick out by a pixel. Anything past that is
// a real mismatch, not rounding.
const CROP_SLOP_PX = 1;

export type ProfileImageCropCode = 'load' | 'invalid' | 'bounds' | 'process';

export class ProfileImageCropError extends Error {
  readonly code: ProfileImageCropCode;

  constructor(code: ProfileImageCropCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProfileImageCropError';
    this.code = code;
  }
}

let init: Promise<void> | null = null;

async function loadDefaultWasm(): Promise<Uint8Array> {
  const res = await fetch(magickWasmUrl);
  if (!res.ok) throw new ProfileImageCropError('load', i18n.t('settings:crop.errors.loadProcessor'));
  return new Uint8Array(await res.arrayBuffer());
}

/** Loads the WASM once. A failed load is forgotten, so the next attempt can
 * try again without reloading the page. Tests can pass the bytes so they
 * don't have to `fetch` the asset URL. */
export function initializeProfileImageMagick(wasmBytes?: Uint8Array): Promise<void> {
  if (init) return init;
  const attempt = (async () => {
    await initializeImageMagick(wasmBytes ?? await loadDefaultWasm());
  })();
  init = attempt;
  void attempt.catch(() => {
    if (init === attempt) init = null;
  });
  return attempt;
}

function roundedCrop(crop: CropRect): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.round(crop.x),
    top: Math.round(crop.y),
    width: Math.round(crop.width),
    height: Math.round(crop.height),
  };
}

/** Pulls a rect that rounding nudged past the bitmap back inside it. */
function cropInside(rect: { left: number; top: number; width: number; height: number }, width: number, height: number) {
  if (rect.width <= 0 || rect.height <= 0) {
    throw new ProfileImageCropError('invalid', i18n.t('settings:crop.errors.invalidCrop'));
  }
  const tooFar = rect.left < -CROP_SLOP_PX || rect.top < -CROP_SLOP_PX
    || rect.left + rect.width > width + CROP_SLOP_PX
    || rect.top + rect.height > height + CROP_SLOP_PX;
  if (tooFar) throw new ProfileImageCropError('bounds', i18n.t('settings:crop.errors.outOfBounds'));
  const left = Math.max(0, rect.left);
  const top = Math.max(0, rect.top);
  const right = Math.min(width, rect.left + rect.width);
  const bottom = Math.min(height, rect.top + rect.height);
  const fitted = { left, top, width: right - left, height: bottom - top };
  if (fitted.width <= 0 || fitted.height <= 0) {
    throw new ProfileImageCropError('invalid', i18n.t('settings:crop.errors.invalidCrop'));
  }
  return fitted;
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
  const requested = roundedCrop(crop);

  try {
    return await ImageMagick.readCollection(bytes, (images) => {
      if (images.length === 0) throw new ProfileImageCropError('process', i18n.t('settings:crop.errors.processFailed'));
      // GIF/WebP frames are often deltas against the previous one — coalesce
      // so the crop rect applies to a full picture on every page. Then turn
      // each frame upright: the browser (and react-easy-crop) already applied
      // the EXIF orientation, and ImageMagick has not.
      if (images.length > 1) images.coalesce();
      for (const frame of images) frame.autoOrient();

      const source = images[0]!;
      const rect = cropInside(requested, source.width, source.height);

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
    const cause = err instanceof Error ? err.message : String(err);
    log.warn('profile image crop failed', { code: 'process', cause, report: true });
    throw new ProfileImageCropError('process', i18n.t('settings:crop.errors.processFailed'), { cause: err });
  }
}

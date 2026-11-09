import sharp, { type Metadata, type Sharp } from 'sharp';

// The crop a person picked in the browser's crop dialog, applied here with
// sharp. Shared by profile images (avatar, banner, server icon, webhook
// avatar) and server emojis; both send the original file plus this rect.

export interface CropRect { left: number; top: number; width: number; height: number }

// The dialog rounds each edge on its own, so a crop that sits on the border
// can stick out by a pixel. Anything past that is a real mismatch.
const CROP_SLOP_PX = 1;

/** `?crop=x,y,width,height` in the source picture's pixels, as the browser
 * shows it (EXIF orientation already applied). Null when absent or malformed. */
export function parseCropParam(raw: unknown): CropRect | null {
  if (typeof raw !== 'string' || !raw) return null;
  const parts = raw.split(',');
  if (parts.length !== 4) return null;
  const numbers = parts.map((part) => (/^\d+(\.\d+)?$/.test(part.trim()) ? Number(part) : NaN));
  if (numbers.some((n) => !Number.isFinite(n))) return null;
  const [left, top, width, height] = numbers.map(Math.round) as [number, number, number, number];
  if (width <= 0 || height <= 0) return null;
  return { left, top, width, height };
}

/** One frame's size the way the crop dialog saw it: upright for a still
 * photo, and a single page (not the whole strip) for an animation. */
export function frameSize(meta: Metadata): { width: number; height: number } | null {
  const animated = (meta.pages ?? 1) > 1;
  const width = animated ? meta.width : meta.autoOrient?.width ?? meta.width;
  const height = animated ? meta.pageHeight ?? meta.height : meta.autoOrient?.height ?? meta.height;
  return width && height ? { width, height } : null;
}

/** Pulls a rect that rounding nudged past the picture back inside it, or
 * null when it really falls outside. */
export function fitCrop(rect: CropRect, width: number, height: number): CropRect | null {
  const tooFar = rect.left + rect.width > width + CROP_SLOP_PX || rect.top + rect.height > height + CROP_SLOP_PX;
  if (tooFar) return null;
  const right = Math.min(width, rect.left + rect.width);
  const bottom = Math.min(height, rect.top + rect.height);
  const fitted = { left: rect.left, top: rect.top, width: right - rect.left, height: bottom - rect.top };
  return fitted.width > 0 && fitted.height > 0 ? fitted : null;
}

/** Every frame cut to `rect` (sharp reads GIF/WebP frames whole, so deltas
 * don't matter). Turning upright first matches what the browser showed. */
export function cropPipeline(input: Buffer, rect: CropRect, animated: boolean, limitInputPixels?: number | boolean): Sharp {
  return sharp(input, { animated, ...(limitInputPixels === undefined ? {} : { limitInputPixels }) })
    .autoOrient()
    .extract(rect);
}

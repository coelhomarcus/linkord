import sharp, { type Metadata } from 'sharp';
import { cropPipeline, fitCrop, frameSize, type CropRect } from '../attachments/imageCrop.js';

// Every server emoji is stored the same way, whatever was uploaded: a 128px
// square WebP, animated when the source was, cut to the square picked in the
// crop dialog. A sticker (modules/stickers) goes through the same encoder at
// its own size. This decides, from the bytes alone, what the file really is:
// the declared Content-Type is never trusted.

export const EMOJI_SIZE_PX = 128;
// the original picture, as picked: a GIF found online is often a few MB
export const MAX_EMOJI_UPLOAD_BYTES = 12 * 1024 * 1024;
// a long animation at 128px can still come out heavy; past this it's refused
const MAX_EMOJI_FILE_BYTES = 512 * 1024;
const MAX_SOURCE_DIMENSION = 4096;
const MAX_FRAMES = 300;
// every frame counts (sharp measures the whole strip): 4096² still or, say,
// a 500px GIF of ~250 frames
const MAX_INPUT_PIXELS = 64 * 1024 * 1024;
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp']);

export type EmojiEncodeError = 'invalid_image' | 'invalid_crop' | 'emoji_too_large';

export interface EncodedEmoji {
  data: Buffer;
  animated: boolean;
}

/** Without a crop the picture is fitted whole: tabs on a build from before
 * the server cropped send a square the browser already cut. */
export async function encodeEmoji(input: Buffer, crop: CropRect | null = null): Promise<EncodedEmoji | EmojiEncodeError> {
  const encoded = await encodeSquareWebp(input, { size: EMOJI_SIZE_PX, maxBytes: MAX_EMOJI_FILE_BYTES, crop });
  return encoded === 'too_large' ? 'emoji_too_large' : encoded;
}

/** `size`px square WebP, the picture fitted whole on a transparent square
 * (after `crop`, when given), animated when the source is; 'too_large' past
 * `maxBytes`. */
export async function encodeSquareWebp(
  input: Buffer,
  options: { size: number; maxBytes: number; crop?: CropRect | null },
): Promise<EncodedEmoji | 'invalid_image' | 'invalid_crop' | 'too_large'> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { animated: true, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    return 'invalid_image';
  }
  const pages = meta.pages ?? 1;
  const frameHeight = meta.pageHeight ?? meta.height ?? 0;
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) return 'invalid_image';
  if (!meta.width || !frameHeight || meta.width > MAX_SOURCE_DIMENSION || frameHeight > MAX_SOURCE_DIMENSION || pages > MAX_FRAMES) return 'invalid_image';
  const animated = pages > 1;
  let rect: CropRect | null = null;
  if (options.crop) {
    const size = frameSize(meta);
    rect = size && fitCrop(options.crop, size.width, size.height);
    if (!rect) return 'invalid_crop';
  }
  let data: Buffer;
  try {
    const image = rect ? cropPipeline(input, rect, animated, false) : sharp(input, { animated, limitInputPixels: false });
    data = await image
      .resize(options.size, options.size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 85, effort: 4 })
      .toBuffer();
  } catch {
    return 'invalid_image';
  }
  if (data.length > options.maxBytes) return 'too_large';
  return { data, animated };
}

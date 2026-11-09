import sharp, { type Metadata } from 'sharp';

// Every server emoji is stored the same way, whatever was uploaded: a 128px
// square WebP, animated when the source was. The client already cropped it to
// a square (web cropProfileImage.ts); this decides, from the bytes alone, what
// the file really is: the declared Content-Type is never trusted.

export const EMOJI_SIZE_PX = 128;
// a cropped upload the client already shrank; what's past this isn't an emoji
export const MAX_EMOJI_UPLOAD_BYTES = 2 * 1024 * 1024;
// a long animation at 128px can still come out heavy; past this it's refused
export const MAX_EMOJI_FILE_BYTES = 512 * 1024;
const MAX_SOURCE_DIMENSION = 4096;
const MAX_FRAMES = 300;
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp']);

export type EmojiEncodeError = 'invalid_image' | 'emoji_too_large';

export interface EncodedEmoji {
  data: Buffer;
  animated: boolean;
}

export async function encodeEmoji(input: Buffer): Promise<EncodedEmoji | EmojiEncodeError> {
  let meta: Metadata;
  try {
    meta = await sharp(input, { animated: true, limitInputPixels: MAX_SOURCE_DIMENSION * MAX_SOURCE_DIMENSION }).metadata();
  } catch {
    return 'invalid_image';
  }
  const pages = meta.pages ?? 1;
  const frameHeight = meta.pageHeight ?? meta.height ?? 0;
  if (!meta.format || !ACCEPTED_FORMATS.has(meta.format)) return 'invalid_image';
  if (!meta.width || !frameHeight || meta.width > MAX_SOURCE_DIMENSION || frameHeight > MAX_SOURCE_DIMENSION || pages > MAX_FRAMES) return 'invalid_image';
  const animated = pages > 1;
  let data: Buffer;
  try {
    data = await sharp(input, { animated, limitInputPixels: false })
      .resize(EMOJI_SIZE_PX, EMOJI_SIZE_PX, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 85, effort: 4 })
      .toBuffer();
  } catch {
    return 'invalid_image';
  }
  if (data.length > MAX_EMOJI_FILE_BYTES) return 'emoji_too_large';
  return { data, animated };
}

import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'attachments' });

// Chat images eligible for a generated thumbnail — same set the frontend
// treats as "image" (web/src/features/chat/ChatAttachment.tsx). Video/audio/
// documents never get one.
export const THUMBNAIL_SOURCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const THUMBNAIL_MAX_DIMENSION = 640;

/** Resizes a just-uploaded chat image down to a small inline-preview copy —
 * same animated-frame handling as the avatar crop (avatarUpload.ts)
 * (`{ animated: true }` + checking `meta.pages`), reused rather than
 * duplicated in spirit, kept separate in code since the encode choices
 * genuinely differ: a chat image can be a transparent PNG (screenshot,
 * sticker) where the avatar path's "always flatten single-frame to JPEG"
 * would bake in an ugly background. Returns null (never throws) when
 * there's nothing worth generating — the source is already thumbnail-sized,
 * or sharp failed for any reason; either way the original attachment still
 * serves fine without a thumbnail. */
/** The size an image is DISPLAYED at — EXIF orientations 5–8 swap width
 * and height — so the client can reserve the right box before it loads.
 * One frame's height for an animation. Null when it can't be read. */
export async function readImageDimensions(src: string | Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const meta = await sharp(src, { animated: true }).metadata();
    const width = meta.width ?? 0;
    const height = meta.pageHeight ?? meta.height ?? 0;
    if (!width || !height) return null;
    return (meta.orientation ?? 1) >= 5 ? { width: height, height: width } : { width, height };
  } catch {
    return null;
  }
}

// ThumbHash reads at most 100x100 pixels
const PLACEHOLDER_MAX_DIMENSION = 100;

/** A blurred stand-in for an image (base64 ThumbHash, a few dozen bytes), for
 * the box to show while the real pixels load. Drawn from the picture as
 * displayed (EXIF orientation applied) and its first frame, with transparency
 * kept so a see-through image isn't painted over a solid colour. Null — never
 * a throw — when it can't be made: the box just stays plain. */
export async function readImagePlaceholder(src: string | Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(src, { animated: false })
      .rotate()
      .resize(PLACEHOLDER_MAX_DIMENSION, PLACEHOLDER_MAX_DIMENSION, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64');
  } catch {
    return null;
  }
}

export async function generateThumbnail(srcPath: string): Promise<{ buffer: Buffer; mime: string } | null> {
  try {
    const image = sharp(srcPath, { animated: true });
    const meta = await image.metadata();
    const frameHeight = meta.pageHeight ?? meta.height ?? 0;
    if (!meta.width || !frameHeight) return null;
    if (meta.width <= THUMBNAIL_MAX_DIMENSION && frameHeight <= THUMBNAIL_MAX_DIMENSION) return null;

    // .rotate() with no angle applies the EXIF orientation: the thumbnail
    // loses its metadata, so a phone photo would otherwise come out sideways
    const resized = image.rotate().resize({
      width: THUMBNAIL_MAX_DIMENSION, height: THUMBNAIL_MAX_DIMENSION, fit: 'inside', withoutEnlargement: true,
    });
    if ((meta.pages ?? 1) > 1) {
      if (meta.format === 'webp') return { buffer: await resized.webp({ quality: 80 }).toBuffer(), mime: 'image/webp' };
      return { buffer: await resized.gif().toBuffer(), mime: 'image/gif' };
    }
    if (meta.hasAlpha) return { buffer: await resized.webp({ quality: 82 }).toBuffer(), mime: 'image/webp' };
    return { buffer: await resized.jpeg({ quality: 82 }).toBuffer(), mime: 'image/jpeg' };
  } catch (err) {
    log.warn('failed to generate thumbnail', { err: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

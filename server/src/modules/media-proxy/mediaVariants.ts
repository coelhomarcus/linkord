import crypto from 'node:crypto';
import sharp, { type Metadata } from 'sharp';

// A proxied picture at the size the browser draws it: `width`/`height` (fit
// inside, never enlarged), `format=webp`, `quality`, `animated=false` (the
// first frame, still). The parameters are not signed: each one only takes
// values from a short fixed list, so a signed address can ask for a few dozen
// variants of its own picture and nothing more. That keeps the cache bounded
// and lets the browser add them to any address the server sends.

/** Mirrored by web/src/shared/lib/mediaProxy.ts (pinned by a test). */
export const PROXY_IMAGE_SIZES = [16, 32, 64, 128, 256, 400, 640, 800, 1280, 1920] as const;

const QUALITY = { high: 80, low: 50 } as const;
// The decoded size sharp may take on, all frames counted: a few-KB file can
// claim to be 30000x30000, and decoding it would cost gigabytes.
export const MAX_INPUT_PIXELS = 40_000_000;
const RENDER_TIMEOUT_S = 5;
const PARAMS = ['width', 'height', 'format', 'quality', 'animated'] as const;

export interface Variant {
  width: number | null;
  height: number | null;
  /** the output is WebP (always so for a still first frame) */
  webp: boolean;
  quality: keyof typeof QUALITY;
  animated: boolean;
}

export class InvalidVariantError extends Error {}

function size(raw: unknown): number | null {
  if (raw === undefined) return null;
  const value = typeof raw === 'string' && /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
  if (!(PROXY_IMAGE_SIZES as readonly number[]).includes(value)) throw new InvalidVariantError('size');
  return value;
}

/** The variant a query asks for; null for none (the original). Throws
 * InvalidVariantError for anything off the lists, a repeated parameter
 * included. */
export function parseVariant(query: Record<string, unknown>): Variant | null {
  if (!PARAMS.some((param) => query[param] !== undefined)) return null;
  for (const param of PARAMS) if (Array.isArray(query[param])) throw new InvalidVariantError(param);
  const { format, quality, animated } = query;
  if (format !== undefined && format !== 'webp') throw new InvalidVariantError('format');
  if (quality !== undefined && quality !== 'high' && quality !== 'low') throw new InvalidVariantError('quality');
  if (animated !== undefined && animated !== 'false') throw new InvalidVariantError('animated');
  return {
    width: size(query.width),
    height: size(query.height),
    webp: format === 'webp' || animated === 'false',
    quality: (quality as Variant['quality'] | undefined) ?? 'high',
    animated: animated !== 'false',
  };
}

/** One string per distinct variant, for the cache. */
export function variantKey(variant: Variant): string {
  return `w=${variant.width ?? ''}&h=${variant.height ?? ''}&f=${variant.webp ? 'webp' : ''}&q=${variant.quality}&a=${variant.animated ? 1 : 0}`;
}

export interface Picture { body: Buffer; contentType: string; etag: string }

export class PixelLimitError extends Error {}

const OUTPUT_TYPES: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', heif: 'image/avif' };

export function etagOf(body: Buffer): string {
  return `"${crypto.createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
}

/** The variant of a picture, or the original when that is no larger. Throws
 * PixelLimitError for a picture too large to decode safely; any other failure (an ICO, which sharp does not read, a
 * broken file) gives the original back: a variant only saves bytes, it is
 * never a reason to lose the picture. */
export async function renderVariant(original: Picture, variant: Variant): Promise<Picture> {
  let meta: Metadata;
  try {
    meta = await sharp(original.body, { animated: variant.animated, limitInputPixels: false }).metadata();
  } catch {
    return original;
  }
  const frames = variant.animated ? (meta.pages ?? 1) : 1;
  const frameHeight = meta.pageHeight ?? meta.height ?? 0;
  if ((meta.width ?? 0) * frameHeight * frames > MAX_INPUT_PIXELS) throw new PixelLimitError();
  const format = variant.webp ? 'webp' : meta.format;
  const contentType = format ? OUTPUT_TYPES[format] : undefined;
  if (!contentType) return original;

  try {
    let pipeline = sharp(original.body, { animated: variant.animated, limitInputPixels: MAX_INPUT_PIXELS });
    // EXIF orientation only exists on stills; turning an animation is not supported
    if (frames === 1) pipeline = pipeline.rotate();
    if (variant.width || variant.height) {
      pipeline = pipeline.resize(variant.width, variant.height, { fit: 'inside', withoutEnlargement: true });
    }
    const quality = QUALITY[variant.quality];
    if (format === 'webp') pipeline = pipeline.webp({ quality });
    else if (format === 'jpeg') pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    // sharp reports AVIF as heif
    else if (format === 'heif') pipeline = pipeline.avif({ quality });
    else if (format === 'png') pipeline = pipeline.png();
    else pipeline = pipeline.gif();
    const body = await pipeline.timeout({ seconds: RENDER_TIMEOUT_S }).toBuffer();
    // A small, already well-compressed original (a flat 1200 px WebP of a few
    // KB) can come out larger: the point is bytes, so it wins then. Not for a
    // still frame, which the original (animated) is not.
    if (variant.animated && body.length >= original.body.length) return original;
    return { body, contentType, etag: etagOf(body) };
  } catch (error) {
    if (error instanceof Error && /pixel limit/i.test(error.message)) throw new PixelLimitError();
    return original;
  }
}

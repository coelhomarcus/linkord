import sharp, { type Metadata, type Sharp } from 'sharp';

// How much sharp may decode from a picture someone else chose: an upload, an
// emoji, a proxied picture. A file of a few hundred bytes can claim a huge
// canvas or hundreds of frames, and each frame is painted at full size before
// anything is resized: a 62-byte GIF of 16000x16000 took 2.2 GB to thumbnail
// under sharp's own limit (268 megapixels).

// Every frame counts. A 48-megapixel phone photo fits, and so does a 500px
// GIF of ~250 frames; a still, decoded as RGBA, stays under ~270 MB.
export const MAX_INPUT_PIXELS = 64 * 1024 * 1024;
// Each frame is quantized again on the way out, so a long run of small frames
// costs time even under the pixel cap.
export const MAX_FRAMES = 300;
// A backstop for the work that passes both caps: measured well under 2 s.
const DECODE_TIMEOUT_S = 10;

/** The header alone (size, frame count, format), which decodes no pixels. It
 * reads past the caps so a caller can tell a picture too large to process
 * from a broken one, and check it with `fitsDecodeLimits`. */
export function readImageHeader(input: string | Buffer): Promise<Metadata> {
  return sharp(input, { animated: true, limitInputPixels: false }).metadata();
}

/** Pixels decoded to read the picture: every frame, or the first alone. */
export function decodedPixels(meta: Metadata, animated: boolean): number {
  const frames = animated ? meta.pages ?? 1 : 1;
  return (meta.width ?? 0) * (meta.pageHeight ?? meta.height ?? 0) * frames;
}

/** Whether every frame of the picture may be decoded. */
export function fitsDecodeLimits(meta: Metadata): boolean {
  return (meta.pages ?? 1) <= MAX_FRAMES && decodedPixels(meta, true) <= MAX_INPUT_PIXELS;
}

/** A pipeline over untrusted input: it refuses past the pixel cap and gives up
 * after the timeout, both as a thrown error. */
export function decodeUntrusted(input: string | Buffer, animated: boolean): Sharp {
  return sharp(input, { animated, limitInputPixels: MAX_INPUT_PIXELS }).timeout({ seconds: DECODE_TIMEOUT_S });
}

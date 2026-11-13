// Leaf module: the size of an uploaded video, as the uploader's browser read it.
// The server has no video decoder, so this is the only way a chat row can
// reserve the player's box before the file's metadata loads. It only shapes
// that box: a wrong value is corrected by the player once the video loads.

// beyond 8K both ways, so a real video always fits
const MAX_VIDEO_SIDE = 16_384;

export interface VideoDimensions {
  width: number;
  height: number;
}

function isSide(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_VIDEO_SIDE;
}

/** `undefined` when the upload says nothing about its size, `null` when it
 * sends one no browser could have read (or sends one for a file that is not
 * a video). */
export function parseVideoDimensions(raw: unknown, mimeType: string): VideoDimensions | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || !mimeType.startsWith('video/')) return null;
  const { width, height } = raw as Record<string, unknown>;
  if (!isSide(width) || !isSide(height)) return null;
  return { width, height };
}

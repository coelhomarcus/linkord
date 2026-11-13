import type { CSSProperties } from 'react';

export interface VideoSize {
  width: number;
  height: number;
}

/** The inline player's caps, shared with the "load video" gate in front of it
 * so clicking the gate does not resize the row. */
export const INLINE_VIDEO_MAX_WIDTH = 384;
export const INLINE_VIDEO_MAX_HEIGHT = 320;

// a size this close to the one already laid out is the same picture
const SAME_SHAPE_TOLERANCE = 0.05;

export function isKnownSize(size: VideoSize | null | undefined): size is VideoSize {
  return !!size && size.width > 0 && size.height > 0;
}

/** Whether two sizes have a different shape, past rounding and a stray
 * letterbox row: only then is a laid-out box worth changing. */
export function differentShape(a: VideoSize, b: VideoSize): boolean {
  const ratioA = a.width / a.height;
  const ratioB = b.width / b.height;
  return Math.abs(ratioA - ratioB) / ratioB > SAME_SHAPE_TOLERANCE;
}

/** The box a video is drawn in: its own shape, never enlarged, within the
 * caps; 16:9 at full width while the size is still unknown. */
export function videoBoxStyle(size: VideoSize | null, maxWidth: number, maxHeight: number): CSSProperties {
  if (isKnownSize(size)) {
    const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
    return { width: size.width * scale, maxWidth: '100%', aspectRatio: `${size.width} / ${size.height}`, maxHeight };
  }
  return { width: maxWidth, maxWidth: '100%', aspectRatio: '16 / 9', maxHeight };
}

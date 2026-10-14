import type { LinkPreviewData } from '@/shared/api/api';

/** Height of the box a picture of unknown size waits in. */
export const EMBED_IMAGE_FALLBACK_HEIGHT = 280;

export interface ImageSize { width: number; height: number }

const isKnown = (size: ImageSize | null): size is ImageSize => !!size && size.width > 0 && size.height > 0;

/** The size the server measured for a link-preview picture, if it did. */
export function previewImageSize(data: Pick<LinkPreviewData, 'imageWidth' | 'imageHeight'> | undefined): ImageSize | null {
  const size = data?.imageWidth && data?.imageHeight ? { width: data.imageWidth, height: data.imageHeight } : null;
  return isKnown(size) ? size : null;
}

/** The box a picture is laid out in, decided before its pixels arrive. A
 * known size fits within the caps without being enlarged; an unknown one
 * gets the fixed fallback, so loading it can never grow the row from zero. */
export function embedImageBox(size: ImageSize | null, maxWidth: number, maxHeight: number = EMBED_IMAGE_FALLBACK_HEIGHT): { width: number; height: number } {
  if (!isKnown(size)) return { width: maxWidth, height: maxHeight };
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
}

/** CSS aspect-ratio for a picture inside a card whose width is already fixed. */
export function embedImageAspect(size: ImageSize | null): string | null {
  return isKnown(size) ? `${size.width} / ${size.height}` : null;
}

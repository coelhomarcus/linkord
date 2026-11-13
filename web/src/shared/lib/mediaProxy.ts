// Third-party pictures come through our own domain (server/src/modules/media-proxy),
// so they show on networks that block those services. The server sends most of
// these addresses ready-made; the two built here are named by an id on a fixed
// host, mirroring server/src/modules/media-proxy/mediaProxyUrls.ts.

const MEDIA_PROXY_PATH = '/api/media-proxy';

export function igdbCoverProxyUrl(imageId: string, size: 'cover_small' | 'cover_big'): string {
  return `${MEDIA_PROXY_PATH}/igdb/${size}/${imageId}`;
}

export function youtubeThumbnailProxyUrl(videoId: string): string {
  return `${MEDIA_PROXY_PATH}/youtube/${videoId}`;
}

/** The widths and heights the proxy will make a variant at. Mirrors
 * PROXY_IMAGE_SIZES in server/src/modules/media-proxy/mediaVariants.ts
 * (pinned by a server test): anything else is refused. */
export const PROXY_IMAGE_SIZES = [16, 32, 64, 128, 256, 400, 640, 800, 1280, 1920] as const;

/** The smallest size the proxy makes that covers `px` device pixels. */
export function snapProxySize(px: number): number {
  return PROXY_IMAGE_SIZES.find((size) => size >= px) ?? PROXY_IMAGE_SIZES[PROXY_IMAGE_SIZES.length - 1];
}

interface VariantRequest {
  /** the width the picture is drawn at, in CSS pixels */
  width: number;
  /** false: the first frame only, still (a GIF thumbnail) */
  animated?: boolean;
}

/** A proxied picture at the size it is drawn (× the screen's pixel density,
 * snapped up to a size the proxy makes), as WebP. Anything that is not one of
 * our proxy's addresses (the proxy switched off, an upload) comes back as
 * it is. The original stays the address to open in full. */
export function proxiedImageVariant(src: string, { width, animated = true }: VariantRequest): string {
  if (!src.startsWith(`${MEDIA_PROXY_PATH}/`)) return src;
  const density = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const [path, query = ''] = src.split('?', 2);
  const params = new URLSearchParams(query);
  params.set('width', String(snapProxySize(Math.ceil(width * density))));
  params.set('format', 'webp');
  if (!animated) params.set('animated', 'false');
  return `${path}?${params.toString()}`;
}

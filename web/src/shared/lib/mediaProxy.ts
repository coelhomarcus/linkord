// Third-party pictures come through our own domain (server/src/modules/media-proxy),
// so they show on networks that block those services. The server sends most of
// these addresses ready-made; the two built here are named by an id on a fixed
// host, mirroring server/src/modules/media-proxy/mediaProxyUrls.ts.

export const MEDIA_PROXY_PATH = '/api/media-proxy';

export function igdbCoverProxyUrl(imageId: string, size: 'cover_small' | 'cover_big'): string {
  return `${MEDIA_PROXY_PATH}/igdb/${size}/${imageId}`;
}

export function youtubeThumbnailProxyUrl(videoId: string): string {
  return `${MEDIA_PROXY_PATH}/youtube/${videoId}`;
}

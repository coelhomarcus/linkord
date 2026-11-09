import crypto from 'node:crypto';
import { igdbCoverUrl, isCoverImageId, type CoverSize } from '../../integrations/igdb/igdb.js';

// The addresses of /api/media-proxy. Never an open proxy: a picture is either
// named by an id on a fixed host (IGDB covers, YouTube thumbnails, which the
// browser can build itself) or carries a URL the server already holds, signed
// with the instance's key, so only URLs that came out of our own payloads are
// ever fetched. A leaf module, free of the database, so every module that
// sends a picture can build its address.

export const MEDIA_PROXY_PATH = '/api/media-proxy';

/** Signed kinds, each with the host its URLs must be on (null: any public
 * host, for the pictures link previews found on arbitrary pages). */
export const SIGNED_KINDS = {
  mal: 'cdn.myanimelist.net',
  github: 'avatars.githubusercontent.com',
  preview: null,
} as const satisfies Record<string, string | null>;
export type SignedKind = keyof typeof SIGNED_KINDS;

export const COVER_SIZES: readonly CoverSize[] = ['cover_small', 'cover_big'];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_TARGET_LENGTH = 2048;
// 128 bits: unguessable, and short enough to keep the address readable
const SIGNATURE_LENGTH = 22;

let key: Buffer | null = null;

/** Set once at boot (mediaProxyKey.ts). Until then — scripts, unit tests of
 * other modules — the signed builders hand back the original URL. */
export function setMediaProxyKey(value: Buffer | null): void {
  key = value;
}

function sign(kind: SignedKind, target: string): string {
  return crypto.createHmac('sha256', key!).update(`${kind}\n${target}`).digest('base64url').slice(0, SIGNATURE_LENGTH);
}

/** The URL as one a kind may fetch, or null: http(s) only (https on the
 * fixed hosts), no credentials, the kind's own host. */
export function allowedTarget(kind: SignedKind, raw: string): URL | null {
  if (raw.length > MAX_TARGET_LENGTH) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password) return null;
  const host = SIGNED_KINDS[kind];
  if (host === null) return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  return url.protocol === 'https:' && url.hostname === host && !url.port ? url : null;
}

/** The proxied address of a picture the server is about to send, or null
 * when the URL is not one this kind may fetch (it is dropped rather than
 * handed to the browser as is). */
export function proxiedImageUrl(kind: SignedKind, url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith(`${MEDIA_PROXY_PATH}/`)) return url;
  if (!key) return url;
  const target = allowedTarget(kind, url);
  if (!target) return null;
  const href = target.href;
  // the URL rides in the query: base64 makes it a third longer, and a path
  // segment past Fastify's 100 characters is a 414
  return `${MEDIA_PROXY_PATH}/${kind}/${sign(kind, href)}?u=${Buffer.from(href, 'utf8').toString('base64url')}`;
}

/** The URL a signed address stands for, or null for a tampered, foreign or
 * malformed one. */
export function verifiedTarget(kind: string, signature: string, encoded: unknown): URL | null {
  if (typeof encoded !== 'string' || !key || !Object.hasOwn(SIGNED_KINDS, kind) || encoded.length > MAX_TARGET_LENGTH * 2) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const href = Buffer.from(encoded, 'base64url').toString('utf8');
  const expected = Buffer.from(sign(kind as SignedKind, href));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  return allowedTarget(kind as SignedKind, href);
}

export function isCoverSize(value: string): value is CoverSize {
  return (COVER_SIZES as readonly string[]).includes(value);
}
export function isYoutubeId(value: string): boolean {
  return YOUTUBE_ID.test(value);
}

/** Mirrored by web/src/shared/lib/mediaProxy.ts, which builds the same ones. */
export function igdbCoverProxyUrl(imageId: string, size: CoverSize): string {
  return `${MEDIA_PROXY_PATH}/igdb/${size}/${imageId}`;
}

/** The upstream of an IGDB cover address, or null. */
export function igdbCoverUpstream(size: string, imageId: string): string | null {
  return isCoverSize(size) && isCoverImageId(imageId) ? igdbCoverUrl(imageId, size) : null;
}

/** The upstream of a YouTube thumbnail address, or null. */
export function youtubeThumbnailUpstream(videoId: string): string | null {
  return isYoutubeId(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
}

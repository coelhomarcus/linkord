import { colorFor } from '@/shared/Avatar';
import { personInitials, titleInitials } from '@/shared/lib/initials';

// A notification's picture drawn by the page: the person (or the server) as the app shows them,
// with the server as a small badge on a channel message, or the inviter on a server invitation.
// The system then shows it like any other notification icon, in the desktop app too.

/** Someone in a circle, or a server in the app's squircle. */
export interface NoticePicture {
  id: string;
  name: string;
  /** an image on the app's own origin; anything else shows the initials */
  src?: string;
  /** a person's chosen avatar colour; a server takes the one its id gives */
  color?: string | null;
  shape: 'circle' | 'squircle';
}

export const FALLBACK_NOTIFICATION_ICON = '/icons/icon-192.png';

const SIZE = 192;
const BADGE = 80;
const BADGE_GAP = 8;
const SQUIRCLE_RADIUS = 0.3;
const LOAD_TIMEOUT_MS = 1500;
const MAX_IMAGE_BYTES = 5_000_000;
const CACHE_LIMIT = 32;

const cache = new Map<string, Promise<string>>();

/** A data URL, or the app icon when the picture cannot be drawn in time. The same pictures are
 * drawn once: a burst of messages from one person reuses the first one. */
export function notificationIcon(main: NoticePicture, badge?: NoticePicture | null): Promise<string> {
  const key = JSON.stringify([main, badge ?? null]);
  const cached = cache.get(key);
  if (cached) return cached;
  const drawn = withTimeout(compose(main, badge ?? null), LOAD_TIMEOUT_MS)
    .catch(() => null)
    .then((url) => {
      // a picture that failed (offline, slow) is tried again by the next notification
      if (!url) cache.delete(key);
      return url ?? FALLBACK_NOTIFICATION_ICON;
    });
  cache.set(key, drawn);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return drawn;
}

export function clearNotificationIcons(): void {
  cache.clear();
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (err: unknown) => { clearTimeout(timer); reject(err); });
  });
}

async function compose(main: NoticePicture, badge: NoticePicture | null): Promise<string | null> {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const [mainImage, badgeImage] = await Promise.all([loadImage(main.src), badge ? loadImage(badge.src) : null]);
  drawPicture(ctx, main, mainImage, 0, 0, SIZE);
  if (badge) {
    const at = SIZE - BADGE;
    // a transparent ring keeps the badge apart from the picture under it, on any background
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    shapePath(ctx, badge.shape, at - BADGE_GAP, at - BADGE_GAP, BADGE + BADGE_GAP * 2);
    ctx.fill();
    ctx.restore();
    drawPicture(ctx, badge, badgeImage, at, at, BADGE);
  }
  mainImage?.close();
  badgeImage?.close();
  return canvas.toDataURL('image/png');
}

/** Only the app's own files: uploads need the session cookie, and a picture from another
 * origin would taint the canvas (or tell that host who is being notified). */
export function ownOriginPath(src: string | undefined): string | null {
  if (!src) return null;
  try {
    const url = new URL(src, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

async function loadImage(src: string | undefined): Promise<ImageBitmap | null> {
  const path = ownOriginPath(src);
  if (!path || typeof createImageBitmap !== 'function') return null;
  try {
    const response = await fetch(path, { credentials: 'same-origin' });
    if (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('image/')) return null;
    const blob = await response.blob();
    if (blob.size > MAX_IMAGE_BYTES) return null;
    // an animated avatar gives its first frame
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

function shapePath(ctx: CanvasRenderingContext2D, shape: NoticePicture['shape'], x: number, y: number, size: number): void {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  else ctx.roundRect(x, y, size, size, size * SQUIRCLE_RADIUS);
}

function drawPicture(ctx: CanvasRenderingContext2D, picture: NoticePicture, image: ImageBitmap | null, x: number, y: number, size: number): void {
  ctx.save();
  shapePath(ctx, picture.shape, x, y, size);
  ctx.clip();
  if (image) {
    // cover: the shorter side fills the shape, the longer one is cut evenly
    const scale = Math.max(size / image.width, size / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    ctx.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height);
  } else {
    ctx.fillStyle = resolveColor(colorFor(picture.id, picture.shape === 'circle' ? picture.color : null));
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${picture.shape === 'circle' ? 700 : 600} ${Math.round(size * (picture.shape === 'circle' ? 0.4 : 0.34))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(picture.shape === 'circle' ? personInitials(picture.name) : titleInitials(picture.name), x + size / 2, y + size / 2);
  }
  ctx.restore();
}

const DEFAULT_COLOR = '#5865f2';

/** The avatar colours are theme tokens (`var(--color-avatar-…)`), which a canvas cannot read. */
export function resolveColor(css: string): string {
  const token = /^var\((--[\w-]+)\)$/.exec(css)?.[1];
  if (!token) return css || DEFAULT_COLOR;
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim() || DEFAULT_COLOR;
}

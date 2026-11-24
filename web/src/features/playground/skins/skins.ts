import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { isSlimSkin, LEGACY_SKIN_HEIGHT, SKIN_HEIGHT, SKIN_WIDTH, upgradeLegacySkin } from './skinFormat';

// Reading a skin file into the pixels the model is painted from, and the PNG
// that is sent to the other players. Every skin is decoded and re-encoded here,
// whether it was picked from disk or received from a peer: what reaches the
// model is always 64×64 RGBA, whatever the file held besides.

export interface Skin {
  pixels: Uint8ClampedArray;
  slim: boolean;
}

/** Larger than any skin re-encoded here (1 to 6 kB), small enough for one LiveKit data packet. */
export const MAX_SKIN_BYTES = 14 * 1024;

export class SkinError extends Error {
  readonly reason: 'size' | 'dimensions' | 'unreadable';

  constructor(reason: 'size' | 'dimensions' | 'unreadable') {
    super(reason);
    this.reason = reason;
  }
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new SkinError('unreadable');
  return { canvas, ctx };
}

/** A PNG (or any image the browser reads) as a skin. Refuses anything that is
 * not 64×64 or 64×32: the layout only makes sense at that size. */
export async function decodeSkin(data: Blob): Promise<Skin> {
  if (data.size > MAX_SKIN_BYTES * 4) throw new SkinError('size');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(data);
  } catch {
    throw new SkinError('unreadable');
  }
  const { width, height } = bitmap;
  if (width !== SKIN_WIDTH || (height !== SKIN_HEIGHT && height !== LEGACY_SKIN_HEIGHT)) {
    bitmap.close();
    throw new SkinError('dimensions');
  }
  const { ctx } = canvasOf(width, height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const read = ctx.getImageData(0, 0, width, height).data;
  const pixels = height === LEGACY_SKIN_HEIGHT ? upgradeLegacySkin(read) : new Uint8ClampedArray(read);
  return { pixels, slim: isSlimSkin(pixels) };
}

/** The skin as a canvas, for a texture or a preview. */
export function skinCanvas(pixels: Uint8ClampedArray): HTMLCanvasElement {
  const { canvas, ctx } = canvasOf(SKIN_WIDTH, SKIN_HEIGHT);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), SKIN_WIDTH, SKIN_HEIGHT), 0, 0);
  return canvas;
}

/** The skin as a clean PNG, the form it is stored and sent in. */
export async function encodeSkin(pixels: Uint8ClampedArray): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await new Promise<Blob | null>((resolve) => skinCanvas(pixels).toBlob(resolve, 'image/png'));
  if (!blob) throw new SkinError('unreadable');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.byteLength > MAX_SKIN_BYTES) throw new SkinError('size');
  return bytes;
}

// The chosen skin stays in this browser; the account default is drawn from its id.
const KEY = LOCAL_STORAGE_KEYS.playgroundSkin;

export function loadSavedSkin(): Uint8Array<ArrayBuffer> | null {
  const stored = localStorageStore.get(KEY);
  if (!stored) return null;
  try {
    return Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function saveSkin(bytes: Uint8Array | null): void {
  if (!bytes) {
    localStorageStore.remove(KEY);
    return;
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  localStorageStore.set(KEY, btoa(binary));
}

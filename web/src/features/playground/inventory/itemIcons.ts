import { useEffect, useSyncExternalStore } from 'react';
import { blockFacePixels } from '../engine/blockTextures';
import { itemIcon } from './items';
import type { ItemIcon } from './items';

// Each item's icon as a picture for the inventory and the hotbar, drawn once and
// kept. A block is drawn the way the game shows one in a slot: a little cube
// seen from above at an angle, its top lit, its left side a little darker and its
// right side darker still (a crafting table or furnace shows its front on the
// left). Anything else is its picture from the pack, as it is. Icons appear as they finish drawing (read through
// useSyncExternalStore), and stay empty where a canvas is not available.

/** pixels per side of an icon: 16 slot pixels, four times over so the cube's edges stay crisp */
const ICON_SIZE = 64;
const TILE = 16;
/** the game's light on a block in a slot: top, left (front) and right side */
const SHADE = { top: 1, left: 0.8, right: 0.6 } as const;

const icons = new Map<string, string>();
const drawing = new Set<string>();
const listeners = new Set<() => void>();

function shaded(pixels: ImageData, shade: number): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  canvas.width = TILE;
  canvas.height = TILE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const copy = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  for (let i = 0; i < copy.data.length; i += 4) {
    copy.data[i] = copy.data[i]! * shade;
    copy.data[i + 1] = copy.data[i + 1]! * shade;
    copy.data[i + 2] = copy.data[i + 2]! * shade;
  }
  ctx.putImageData(copy, 0, 0);
  return canvas;
}

/** The cube: each 16×16 face mapped onto its side of an isometric block filling the icon. */
async function drawBlock(icon: Extract<ItemIcon, { kind: 'block' }>): Promise<string | null> {
  const block = icon.block as Parameters<typeof blockFacePixels>[0];
  const [top, front, side] = await Promise.all([blockFacePixels(block, 'top'), blockFacePixels(block, 'front'), blockFacePixels(block, 'side')]);
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d');
  const faces = [shaded(top, SHADE.top), shaded(front, SHADE.left), shaded(side, SHADE.right)];
  if (!ctx || faces.some((face) => !face)) return null;
  ctx.imageSmoothingEnabled = false;
  const half = ICON_SIZE / 2;
  // corners of the cube's outline: the top face's four, and the bottom edge
  const w = (ICON_SIZE * 0.88) / 2;
  const tilt = w / 2;
  const height = w * 1.06;
  const topY = (ICON_SIZE - (tilt * 2 + height)) / 2;
  const T = [half, topY];
  const L = [half - w, topY + tilt];
  const R = [half + w, topY + tilt];
  const B = [half, topY + tilt * 2];
  const unit = (from: number[], to: number[]) => [(to[0]! - from[0]!) / TILE, (to[1]! - from[1]!) / TILE];
  const down = [0, height / TILE];
  const draw = (face: HTMLCanvasElement, origin: number[], x: number[], y: number[]) => {
    ctx.setTransform(x[0]!, x[1]!, y[0]!, y[1]!, origin[0]!, origin[1]!);
    ctx.drawImage(face, 0, 0);
  };
  draw(faces[1]!, L, unit(L, B), down);
  draw(faces[2]!, B, unit(B, R), down);
  draw(faces[0]!, T, unit(T, R), unit(T, L));
  return canvas.toDataURL();
}

function request(itemId: string): void {
  if (icons.has(itemId) || drawing.has(itemId)) return;
  const icon = itemIcon(itemId);
  if (!icon) return;
  if (icon.kind === 'sprite') {
    icons.set(itemId, icon.url);
    for (const listener of listeners) listener();
    return;
  }
  drawing.add(itemId);
  void drawBlock(icon).then((url) => {
    if (!url) return;
    icons.set(itemId, url);
    for (const listener of listeners) listener();
  }).catch(() => {
    // no picture: the slot shows the item's count only
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The icon of an item (a data URL), or null until it is drawn. */
export function useItemIcon(itemId: string | null): string | null {
  const url = useSyncExternalStore(subscribe, () => (itemId ? icons.get(itemId) ?? null : null));
  useEffect(() => { if (itemId) request(itemId); }, [itemId]);
  return url;
}

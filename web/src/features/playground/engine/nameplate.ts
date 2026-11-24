import * as THREE from 'three';
import { PIXEL_FONT } from '../pixelFont';
import { drawPixelIcon, PIXEL_ICON_GRID } from '../pixelIcons';
import type { PixelIconName } from '../pixelIcons';

// A name floating over an avatar, drawn on a canvas so it is one sprite (one
// draw call) and always faces the camera, in the playground's pixel font. A
// green border while they speak, as on a call tile, and after the name the
// menu's pixel icons for a muted mic, a deafened ear or the big screen. Drawn
// again only when one of those changes, never per frame.

// monogram is drawn on a 12-pixel grid; whole multiples keep its pixels square
const HEIGHT_PX = 72;
const FONT_PX = 48;
const PADDING_X = 18;
const RING_PX = 6;
const MAX_TEXT_PX = 640;
/** canvas pixels per icon grid pixel: the icon as tall as the font */
const ICON_SCALE = FONT_PX / PIXEL_ICON_GRID;
const ICON_PX = PIXEL_ICON_GRID * ICON_SCALE;
const TEXT_GAP_PX = 12;
const ICON_GAP_PX = 6;
/** metres the label is tall in the world */
const WORLD_HEIGHT = 0.3;
const SPEAKING = '#23a55a';
const ICON_COLOR = '#ffffff';
const SCREEN_GLASS = '#7ec8ff';

export interface NameplateStatus {
  speaking: boolean;
  micMuted: boolean;
  deafened: boolean;
  /** on the big screen */
  presenting: boolean;
}

export const QUIET: NameplateStatus = { speaking: false, micMuted: false, deafened: false, presenting: false };

interface NameplateIcon { name: PixelIconName; off: boolean }

/** The icons after the name, in order. Deafened stands for muted too, as on a call tile. */
export function nameplateIcons(status: NameplateStatus): NameplateIcon[] {
  const icons: NameplateIcon[] = [];
  if (status.deafened) icons.push({ name: 'speaker', off: true });
  else if (status.micMuted) icons.push({ name: 'mic', off: true });
  if (status.presenting) icons.push({ name: 'screen', off: false });
  return icons;
}

export interface NameplateLayout {
  /** canvas width, whole pixels */
  width: number;
  textWidth: number;
  /** where the name is centred */
  textCenter: number;
  /** left edge of each icon, whole pixels so its grid stays square */
  iconX: number[];
  iconY: number;
}

/** Where the name and `icons` icons go on a label whose name measures `measured` pixels. */
export function nameplateLayout(measured: number, icons: number): NameplateLayout {
  const textWidth = Math.ceil(Math.min(measured, MAX_TEXT_PX));
  const iconX: number[] = [];
  let x = PADDING_X + textWidth + (textWidth > 0 ? TEXT_GAP_PX : 0);
  for (let i = 0; i < icons; i++) {
    iconX.push(x);
    x += ICON_PX + ICON_GAP_PX;
  }
  const right = icons > 0 ? x - ICON_GAP_PX : PADDING_X + textWidth;
  return { width: right + PADDING_X, textWidth, textCenter: PADDING_X + textWidth / 2, iconX, iconY: (HEIGHT_PX - ICON_PX) / 2 };
}

const sameStatus = (a: NameplateStatus, b: NameplateStatus) =>
  a.speaking === b.speaking && a.micMuted === b.micMuted && a.deafened === b.deafened && a.presenting === b.presenting;

export class Nameplate {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private name: string | null = null;
  private status: NameplateStatus = QUIET;

  constructor(name: string) {
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    const material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(material);
    this.sprite.renderOrder = 10;
    this.set(name, QUIET);
  }

  set(name: string, status: NameplateStatus): void {
    if (name === this.name && sameStatus(status, this.status)) return;
    this.name = name;
    this.status = { ...status };
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const font = `${FONT_PX}px ${PIXEL_FONT}, monospace`;
    ctx.font = font;
    const icons = nameplateIcons(status);
    const layout = nameplateLayout(ctx.measureText(name).width, icons.length);
    const { width } = layout;
    this.canvas.width = width;
    this.canvas.height = HEIGHT_PX;
    // resizing the canvas resets its state
    ctx.font = font;
    ctx.clearRect(0, 0, width, HEIGHT_PX);
    // square corners: a pixel-art label, not a pill
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(RING_PX, RING_PX, width - RING_PX * 2, HEIGHT_PX - RING_PX * 2);
    if (status.speaking) {
      ctx.fillStyle = SPEAKING;
      ctx.fillRect(0, 0, width, RING_PX);
      ctx.fillRect(0, HEIGHT_PX - RING_PX, width, RING_PX);
      ctx.fillRect(0, 0, RING_PX, HEIGHT_PX);
      ctx.fillRect(width - RING_PX, 0, RING_PX, HEIGHT_PX);
    }
    if (layout.textWidth > 0) {
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name, layout.textCenter, HEIGHT_PX / 2, layout.textWidth);
    }
    icons.forEach((icon, i) => {
      drawPixelIcon(ctx, icon.name, layout.iconX[i]!, layout.iconY, ICON_SCALE, { color: ICON_COLOR, glass: SCREEN_GLASS, off: icon.off });
    });
    this.texture.dispose();
    this.texture.needsUpdate = true;
    this.sprite.scale.set((WORLD_HEIGHT * width) / HEIGHT_PX, WORLD_HEIGHT, 1);
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

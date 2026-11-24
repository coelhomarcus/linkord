import * as THREE from 'three';
import { PIXEL_FONT } from '../pixelFont';

// A name floating over an avatar, drawn on a canvas so it is one sprite (one
// draw call) and always faces the camera, in the playground's pixel font. A
// green border while they speak, as on a call tile.

// monogram is drawn on a 12-pixel grid; whole multiples keep its pixels square
const HEIGHT_PX = 72;
const FONT_PX = 48;
const PADDING_X = 18;
const RING_PX = 6;
/** metres the label is tall in the world */
const WORLD_HEIGHT = 0.3;
const SPEAKING = '#23a55a';

export class Nameplate {
  readonly sprite: THREE.Sprite;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: THREE.CanvasTexture;
  private name = '';
  private speaking = false;

  constructor(name: string) {
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    const material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(material);
    this.sprite.renderOrder = 10;
    this.set(name, false);
  }

  set(name: string, speaking: boolean): void {
    if (name === this.name && speaking === this.speaking) return;
    this.name = name;
    this.speaking = speaking;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const font = `${FONT_PX}px ${PIXEL_FONT}, monospace`;
    ctx.font = font;
    const width = Math.ceil(Math.min(ctx.measureText(name).width, 640) + PADDING_X * 2);
    this.canvas.width = width;
    this.canvas.height = HEIGHT_PX;
    // resizing the canvas resets its state
    ctx.font = font;
    ctx.clearRect(0, 0, width, HEIGHT_PX);
    // square corners: a pixel-art label, not a pill
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(RING_PX, RING_PX, width - RING_PX * 2, HEIGHT_PX - RING_PX * 2);
    if (speaking) {
      ctx.fillStyle = SPEAKING;
      ctx.fillRect(0, 0, width, RING_PX);
      ctx.fillRect(0, HEIGHT_PX - RING_PX, width, RING_PX);
      ctx.fillRect(0, 0, RING_PX, HEIGHT_PX);
      ctx.fillRect(width - RING_PX, 0, RING_PX, HEIGHT_PX);
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, width / 2, HEIGHT_PX / 2, width - PADDING_X * 2);
    this.texture.dispose();
    this.texture.needsUpdate = true;
    this.sprite.scale.set((WORLD_HEIGHT * width) / HEIGHT_PX, WORLD_HEIGHT, 1);
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

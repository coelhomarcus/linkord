import * as THREE from 'three';
import { NO_OUTLINE_LAYER } from './outlineRenderer';

// A name floating over an avatar, drawn on a canvas so it is one sprite (one
// draw call) and always faces the camera. A green ring while they speak, as on
// a call tile.

const HEIGHT_PX = 96;
const FONT_PX = 44;
const PADDING_X = 28;
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
    const material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.sprite = new THREE.Sprite(material);
    this.sprite.renderOrder = 10;
    this.sprite.layers.set(NO_OUTLINE_LAYER);
    this.set(name, false);
  }

  set(name: string, speaking: boolean): void {
    if (name === this.name && speaking === this.speaking) return;
    this.name = name;
    this.speaking = speaking;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const font = `600 ${FONT_PX}px "Figtree Variable", system-ui, sans-serif`;
    ctx.font = font;
    const width = Math.ceil(Math.min(ctx.measureText(name).width, 640) + PADDING_X * 2);
    this.canvas.width = width;
    this.canvas.height = HEIGHT_PX;
    // resizing the canvas resets its state
    ctx.font = font;
    ctx.clearRect(0, 0, width, HEIGHT_PX);
    const radius = (HEIGHT_PX - RING_PX * 2) / 2;
    ctx.beginPath();
    ctx.roundRect(RING_PX, RING_PX, width - RING_PX * 2, HEIGHT_PX - RING_PX * 2, radius);
    ctx.fillStyle = 'rgba(17, 18, 20, 0.72)';
    ctx.fill();
    if (speaking) {
      ctx.lineWidth = RING_PX;
      ctx.strokeStyle = SPEAKING;
      ctx.stroke();
    }
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, width / 2, HEIGHT_PX / 2 + 2, width - PADDING_X * 2);
    this.texture.dispose();
    this.texture.needsUpdate = true;
    this.sprite.scale.set((WORLD_HEIGHT * width) / HEIGHT_PX, WORLD_HEIGHT, 1);
  }

  dispose(): void {
    this.texture.dispose();
    this.sprite.material.dispose();
  }
}

import * as THREE from 'three';
import { pixelTexture } from './blockTextures';

// The cracks on a block being dug, the block game's ten stages (Pixel
// Perfection's destroy_stage_0..9), drawn as a box a hair larger than the block.

const STAGES = Object.values(import.meta.glob<string>('../assets/pixel-perfection/destroy/destroy_stage_*.png', { eager: true, query: '?url', import: 'default' }))
  .sort((a, b) => Number(/destroy_stage_(\d+)/.exec(a)?.[1]) - Number(/destroy_stage_(\d+)/.exec(b)?.[1]));

export class BreakOverlay {
  readonly object: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly textures: THREE.Texture[] = [];
  private stage = -1;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.object = new THREE.Mesh(new THREE.BoxGeometry(1.004, 1.004, 1.004), this.material);
    this.object.visible = false;
    this.object.renderOrder = 2;
    for (const url of STAGES) {
      const canvas = document.createElement('canvas');
      canvas.width = 16;
      canvas.height = 16;
      const texture = pixelTexture(canvas);
      const image = new Image();
      image.onload = () => {
        canvas.getContext('2d')?.drawImage(image, 0, 0, 16, 16);
        texture.needsUpdate = true;
      };
      image.src = url;
      this.textures.push(texture);
    }
  }

  /** Cracks `progress` (0..1) of the way on the block at `cell`, or none. */
  show(cell: { x: number; y: number; z: number } | null, progress = 0): void {
    if (!cell || this.textures.length === 0) {
      this.object.visible = false;
      return;
    }
    const stage = Math.min(this.textures.length - 1, Math.floor(progress * this.textures.length));
    if (stage !== this.stage) {
      this.stage = stage;
      this.material.map = this.textures[stage]!;
      this.material.needsUpdate = true;
    }
    this.object.position.set(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
    this.object.visible = true;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
    for (const texture of this.textures) texture.dispose();
  }
}

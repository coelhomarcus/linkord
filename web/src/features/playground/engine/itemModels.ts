import * as THREE from 'three';
import { itemDef } from '@game/items';
import { itemIcon } from '../inventory/items';
import { faceTile, tileUv } from './blockTextures';
import type { TileName } from './blockTextures';
import { FACE_SHADE } from './voxelWorld';

// Items as things in the world, for the ground and for hands, built the block
// game's way: a block is a cube of its own faces; anything else is its 16×16
// picture pushed out one pixel thick, each opaque pixel a little box (the
// game's generated item model). Either is centred on its origin and one block
// across; whoever shows it scales it. A picture appears once it has loaded.

const PIXELS = 16;
/** the shade of a picture's sides, as the game lights an item's edge */
const EDGE_SHADE = 0.8;

export type ItemShape = 'block' | 'flat';

/** An item in the world: its object and what makes it lighter or darker where it is. */
export interface ItemModel {
  object: THREE.Group;
  shape: ItemShape;
  /** a tool or a stick, held by its handle (the game's item/handheld model); other pictures are held flat */
  handheld: boolean;
  setLight(brightness: number): void;
  dispose(): void;
}

function loadPixels(url: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = PIXELS;
      canvas.height = PIXELS;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('no canvas'));
      ctx.drawImage(image, 0, 0, PIXELS, PIXELS);
      resolve(ctx.getImageData(0, 0, PIXELS, PIXELS));
    };
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
}

/** The picture pushed out one pixel thick: a front and a back per opaque pixel, and a side wherever the
 * next pixel is clear. Colours are the pixels', no texture needed. */
function flatGeometry(pixels: ImageData): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const unit = 1 / PIXELS;
  const half = unit / 2;
  const opaqueAt = (px: number, py: number) => px >= 0 && py >= 0 && px < PIXELS && py < PIXELS && pixels.data[(py * PIXELS + px) * 4 + 3]! > 127;
  const quad = (corners: number[][], rgb: number[], shade: number) => {
    const start = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      colors.push(rgb[0]! * shade, rgb[1]! * shade, rgb[2]! * shade);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  for (let py = 0; py < PIXELS; py++) {
    for (let px = 0; px < PIXELS; px++) {
      if (!opaqueAt(px, py)) continue;
      const i = (py * PIXELS + px) * 4;
      const rgb = [pixels.data[i]! / 255, pixels.data[i + 1]! / 255, pixels.data[i + 2]! / 255].map((c) => c ** 2.2);
      const x0 = px * unit - 0.5;
      const x1 = x0 + unit;
      // the picture's top row is the model's top
      const y1 = 0.5 - py * unit;
      const y0 = y1 - unit;
      quad([[x0, y0, half], [x1, y0, half], [x1, y1, half], [x0, y1, half]], rgb, 1);
      quad([[x1, y0, -half], [x0, y0, -half], [x0, y1, -half], [x1, y1, -half]], rgb, 1);
      if (!opaqueAt(px - 1, py)) quad([[x0, y0, -half], [x0, y0, half], [x0, y1, half], [x0, y1, -half]], rgb, EDGE_SHADE);
      if (!opaqueAt(px + 1, py)) quad([[x1, y0, half], [x1, y0, -half], [x1, y1, -half], [x1, y1, half]], rgb, EDGE_SHADE);
      if (!opaqueAt(px, py - 1)) quad([[x0, y1, half], [x1, y1, half], [x1, y1, -half], [x0, y1, -half]], rgb, 1);
      if (!opaqueAt(px, py + 1)) quad([[x0, y0, -half], [x1, y0, -half], [x1, y0, half], [x0, y0, half]], rgb, EDGE_SHADE * 0.7);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** A block as a cube of its faces from the atlas, each face shaded by the way it points. */
function cubeGeometry(block: Parameters<typeof faceTile>[0]): THREE.BufferGeometry {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const uv = geometry.attributes.uv!;
  const colors: number[] = [];
  // BoxGeometry's faces are +x, -x, +y, -y, +z, -z, like the world's; the cube faces its front at -z
  for (let face = 0; face < 6; face++) {
    const tile = tileUv(faceTile(block, face, { facing: 2, lit: false }) as TileName);
    uv.setXY(face * 4, tile.u0, tile.v1);
    uv.setXY(face * 4 + 1, tile.u1, tile.v1);
    uv.setXY(face * 4 + 2, tile.u0, tile.v0);
    uv.setXY(face * 4 + 3, tile.u1, tile.v0);
    for (let i = 0; i < 4; i++) colors.push(FACE_SHADE[face]!, FACE_SHADE[face]!, FACE_SHADE[face]!);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

export class ItemModels {
  private readonly atlas: THREE.Texture;
  private readonly cubes = new Map<number, THREE.BufferGeometry>();
  private readonly flats = new Map<string, Promise<THREE.BufferGeometry | null>>();
  private disposed = false;

  constructor(atlas: THREE.Texture) {
    this.atlas = atlas;
  }

  /** How an item is shown: a block's cube, or a picture; null for one this version does not know. */
  shapeOf(itemId: string): ItemShape | null {
    const icon = itemIcon(itemId);
    return icon ? (icon.kind === 'block' ? 'block' : 'flat') : null;
  }

  create(itemId: string): ItemModel | null {
    const icon = itemIcon(itemId);
    if (!icon) return null;
    const object = new THREE.Group();
    if (icon.kind === 'block') {
      let geometry = this.cubes.get(icon.block);
      if (!geometry) {
        geometry = cubeGeometry(icon.block as Parameters<typeof faceTile>[0]);
        this.cubes.set(icon.block, geometry);
      }
      const material = new THREE.MeshBasicMaterial({ map: this.atlas, vertexColors: true, alphaTest: 0.5 });
      object.add(new THREE.Mesh(geometry, material));
      return { object, shape: 'block', handheld: false, setLight: (b) => material.color.setScalar(b), dispose: () => { object.removeFromParent(); material.dispose(); } };
    }
    // both sides: a hand may show it mirrored
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    let pending = this.flats.get(itemId);
    if (!pending) {
      pending = loadPixels(icon.url).then(flatGeometry).catch(() => null);
      this.flats.set(itemId, pending);
    }
    let gone = false;
    void pending.then((geometry) => {
      if (geometry && !gone && !this.disposed) object.add(new THREE.Mesh(geometry, material));
    });
    const handheld = !!itemDef(itemId)?.tool || itemId === 'stick';
    return { object, shape: 'flat', handheld, setLight: (b) => material.color.setScalar(b), dispose: () => { gone = true; object.removeFromParent(); material.dispose(); } };
  }

  dispose(): void {
    this.disposed = true;
    for (const geometry of this.cubes.values()) geometry.dispose();
    for (const pending of this.flats.values()) void pending.then((geometry) => geometry?.dispose());
  }
}

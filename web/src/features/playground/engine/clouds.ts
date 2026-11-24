import * as THREE from 'three';
import cloudsUrl from '../assets/pixel-perfection/environment/clouds.png?url';

// The block game's clouds: one slab, 4 blocks thick, cut from a pattern
// (Pixel Perfection's clouds.png, a 256 × 256 picture that wraps around) where
// every opaque pixel is a 12 × 12 block cell of cloud. Neighbouring cells share
// one surface: only the faces that look out at the sky are built, each side
// shaded as the game shades them, so clouds never show one inside another. They
// are see-through, so they are drawn twice, the way minecraft-renderer does it
// (github.com/zardoy/minecraft-renderer, MIT): first only into the depth
// buffer, then in colour against it, which keeps a face behind another from
// showing through. The pattern drifts toward -x at the game's 0.6 blocks a
// second, the slab rebuilt around the island each time it moves a whole cell.

export const CLOUD_CELL = 12;
const CLOUD_THICKNESS = 4;
const CLOUD_HEIGHT = 44;
const CLOUD_OPACITY = 0.8;
const DRIFT_PER_SECOND = 0.6;
/** cells built around the island on each side: past the fog, they are sky */
const RADIUS = 12;
const SHADE = { top: 1, bottom: 0.7, northSouth: 0.8, eastWest: 0.9 } as const;

/** Which cells of the pattern hold cloud, row by row; the pattern wraps both ways. */
export interface CloudCover {
  width: number;
  height: number;
  filled: Uint8Array;
}

const mod = (n: number, m: number) => ((n % m) + m) % m;

/** The slab for the cells within `radius` of the pattern's cell (`centerX`, `centerZ`), in blocks from
 * that cell's corner: the top and bottom of every cloud cell, and a side only where no cloud is next to it. */
export function cloudGeometry(cover: CloudCover, centerX: number, centerZ: number, radius: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const filled = (x: number, z: number) => cover.filled[mod(z, cover.height) * cover.width + mod(x, cover.width)] === 1;
  // corners listed counter-clockwise seen from outside
  const quad = (shade: number, corners: number[][]) => {
    const first = positions.length / 3;
    for (const corner of corners) {
      positions.push(...corner);
      colors.push(shade, shade, shade);
    }
    indices.push(first, first + 1, first + 2, first, first + 2, first + 3);
  };
  const h = CLOUD_THICKNESS;
  for (let i = -radius; i <= radius; i++) {
    for (let j = -radius; j <= radius; j++) {
      const cx = centerX + i;
      const cz = centerZ + j;
      if (!filled(cx, cz)) continue;
      const x0 = i * CLOUD_CELL;
      const x1 = x0 + CLOUD_CELL;
      const z0 = j * CLOUD_CELL;
      const z1 = z0 + CLOUD_CELL;
      quad(SHADE.top, [[x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0]]);
      quad(SHADE.bottom, [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1]]);
      if (!filled(cx + 1, cz)) quad(SHADE.eastWest, [[x1, 0, z0], [x1, h, z0], [x1, h, z1], [x1, 0, z1]]);
      if (!filled(cx - 1, cz)) quad(SHADE.eastWest, [[x0, 0, z1], [x0, h, z1], [x0, h, z0], [x0, 0, z0]]);
      if (!filled(cx, cz + 1)) quad(SHADE.northSouth, [[x1, 0, z1], [x1, h, z1], [x0, h, z1], [x0, 0, z1]]);
      if (!filled(cx, cz - 1)) quad(SHADE.northSouth, [[x0, 0, z0], [x0, h, z0], [x1, h, z0], [x1, 0, z0]]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  return geometry;
}

async function loadCover(url: string): Promise<CloudCover> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  const filled = new Uint8Array(image.width * image.height);
  for (let i = 0; i < filled.length; i++) filled[i] = data[i * 4 + 3]! >= 128 ? 1 : 0;
  return { width: image.width, height: image.height, filled };
}

export class Clouds {
  readonly group = new THREE.Group();
  private readonly colorPass = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: CLOUD_OPACITY, depthWrite: false });
  private readonly depthPass = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: true });
  private cover: CloudCover | null = null;
  private geometry: THREE.BufferGeometry | null = null;
  private drift = 0;
  private builtCell: number | null = null;
  private disposed = false;

  constructor() {
    this.group.position.y = CLOUD_HEIGHT;
    void loadCover(cloudsUrl).then((cover) => {
      if (this.disposed) return;
      this.cover = cover;
      this.update(0);
    }).catch(() => {
      // no clouds: the sky stays clear
    });
  }

  /** The clouds darken with the sky as the game darkens them: `daylight` (0..1, game/dayTime.ts) takes
   * them from white down to a tenth, in the night's `tint`. */
  setDaylight(daylight: number, tint: THREE.Color): void {
    const level = daylight * 0.9 + 0.1;
    this.colorPass.color.setRGB(level, level, level, THREE.SRGBColorSpace).multiply(tint);
  }

  update(dt: number): void {
    this.drift += dt * DRIFT_PER_SECOND;
    if (!this.cover) return;
    const cell = Math.floor(this.drift / CLOUD_CELL);
    if (cell !== this.builtCell) this.build(cell);
    // the pattern moves toward -x: the slab built around `cell` slides back by what is left of a cell
    this.group.position.x = cell * CLOUD_CELL - this.drift;
  }

  private build(cell: number): void {
    this.builtCell = cell;
    this.geometry?.dispose();
    this.group.clear();
    this.geometry = cloudGeometry(this.cover!, cell, 0, RADIUS);
    // the depth first, then the colour against it
    const depth = new THREE.Mesh(this.geometry, this.depthPass);
    depth.renderOrder = 2;
    const color = new THREE.Mesh(this.geometry, this.colorPass);
    color.renderOrder = 3;
    this.group.add(depth, color);
  }

  dispose(): void {
    this.disposed = true;
    this.geometry?.dispose();
    this.colorPass.dispose();
    this.depthPass.dispose();
    this.group.removeFromParent();
  }
}

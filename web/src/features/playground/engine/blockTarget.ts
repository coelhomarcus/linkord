import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { Wireframe } from 'three/addons/lines/Wireframe.js';

// The block the crosshair is on, outlined the block game's way: a ray from the
// eyes along the view, as far as a player reaches, and a thin black box around
// the first block it meets. The outline's look (black, about two pixels, a box
// a hair larger than the block) is minecraft-renderer's cursorBlock.ts
// (github.com/zardoy/minecraft-web-client, MIT, Copyright (c) 2020 PrismarineJS).

/** How far a player reaches, in blocks. */
export const REACH = 4.5;

export interface BlockHit {
  x: number;
  y: number;
  z: number;
  /** the face the ray came in through, as the direction it faces (all 0 when the ray starts inside) */
  face: [number, number, number];
}

/** The first cell along the ray (unit `direction`) within `reach` that `isBlock` says holds a block,
 * stepping cell by cell (Amanatides and Woo's traversal), or null. */
export function targetBlock(
  isBlock: (x: number, y: number, z: number) => boolean,
  origin: { x: number; y: number; z: number },
  direction: { x: number; y: number; z: number },
  reach = REACH,
): BlockHit | null {
  const cell = [Math.floor(origin.x), Math.floor(origin.y), Math.floor(origin.z)];
  const start = [origin.x, origin.y, origin.z];
  const dir = [direction.x, direction.y, direction.z];
  const step = dir.map((d) => Math.sign(d));
  const delta = dir.map((d) => (d === 0 ? Infinity : Math.abs(1 / d)));
  const next = dir.map((d, i) => {
    if (d === 0) return Infinity;
    const border = d > 0 ? cell[i]! + 1 - start[i]! : start[i]! - cell[i]!;
    return border * delta[i]!;
  });
  if (isBlock(cell[0]!, cell[1]!, cell[2]!)) return { x: cell[0]!, y: cell[1]!, z: cell[2]!, face: [0, 0, 0] };
  for (;;) {
    const axis = next[0]! < next[1]! ? (next[0]! < next[2]! ? 0 : 2) : next[1]! < next[2]! ? 1 : 2;
    if (next[axis]! > reach) return null;
    cell[axis]! += step[axis]!;
    next[axis]! += delta[axis]!;
    if (isBlock(cell[0]!, cell[1]!, cell[2]!)) {
      const face: [number, number, number] = [0, 0, 0];
      face[axis] = -step[axis]!;
      return { x: cell[0]!, y: cell[1]!, z: cell[2]!, face };
    }
  }
}

/** The outline drawn around the targeted block. */
export class BlockOutline {
  readonly object: Wireframe;
  private readonly material: LineMaterial;

  constructor() {
    this.material = new LineMaterial({ color: 0x000000, linewidth: 2, transparent: true, opacity: 0.45 });
    const box = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.002, 1.002, 1.002));
    this.object = new Wireframe(new LineSegmentsGeometry().fromEdgesGeometry(box), this.material);
    box.dispose();
    this.object.visible = false;
  }

  /** Puts the box on `hit`, or hides it. */
  show(hit: BlockHit | null): void {
    this.object.visible = !!hit;
    if (hit) this.object.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
  }

  /** Line widths are in pixels: the material needs the canvas size. */
  setResolution(width: number, height: number, pixelRatio: number): void {
    this.material.resolution.set(width * pixelRatio, height * pixelRatio);
    this.material.linewidth = Math.max(pixelRatio * 0.7, 1) * 2;
  }

  dispose(): void {
    this.object.removeFromParent();
    this.object.geometry.dispose();
    this.material.dispose();
  }
}

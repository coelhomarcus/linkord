import { BLOCK } from '@game/blocks';

// A chest as the block game draws it: not a cube but three boxes, a body, its
// lid and the latch, a pixel in from the cell's sides, painted from a 64×64
// entity texture (Pixel Perfection's entity/chest/normal.png; the creative
// chest wears its ender.png). Each box takes its faces from the texture the
// way the game's model boxes do: from a corner (u, v), the box's depth, width
// and height side by side, and the game draws the 1.15+ textures turned
// half round, as here. The front faces +z before the block's state turns it
// (game/blocks.ts: +z, -x, -z, +x).

/** a box: where it sits in the cell (pixels), and its texture's corner */
interface ChestBox { min: [number, number, number]; max: [number, number, number]; u: number; v: number }

/** the game's single chest: the body, the lid on it, the latch on the lid's front */
export const CHEST_BOXES: readonly ChestBox[] = [
  { min: [1, 0, 1], max: [15, 10, 15], u: 0, v: 19 },
  { min: [1, 9, 1], max: [15, 14, 15], u: 0, v: 0 },
  { min: [7, 7, 15], max: [9, 11, 16], u: 0, v: 0 },
];

/** A face of a box: its four corners in the cell (pixels) and their texture pixels, and which way it faces. */
export interface ChestFace {
  normal: [number, number, number];
  corners: [number, number, number][];
  uvs: [number, number][];
}

/** The six faces of a box, the game's way (ModelPart's cube): which part of the texture each takes, and
 * which corner of it each vertex gets. */
function boxFaces({ min, max, u, v }: ChestBox): ChestFace[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const w = x1 - x0;
  const h = y1 - y0;
  const d = z1 - z0;
  const p0: [number, number, number] = [x0, y0, z0];
  const p1: [number, number, number] = [x1, y0, z0];
  const p2: [number, number, number] = [x1, y1, z0];
  const p3: [number, number, number] = [x0, y1, z0];
  const p4: [number, number, number] = [x0, y0, z1];
  const p5: [number, number, number] = [x1, y0, z1];
  const p6: [number, number, number] = [x1, y1, z1];
  const p7: [number, number, number] = [x0, y1, z1];
  // a polygon's corners take (u2, v1), (u1, v1), (u1, v2), (u2, v2) of its rectangle
  const face = (normal: [number, number, number], corners: [number, number, number][], u1: number, v1: number, u2: number, v2: number): ChestFace =>
    ({ normal, corners, uvs: [[u2, v1], [u1, v1], [u1, v2], [u2, v2]] });
  return [
    face([0, -1, 0], [p5, p4, p0, p1], u + d, v, u + d + w, v + d),
    face([0, 1, 0], [p2, p3, p7, p6], u + d + w, v + d, u + d + w + w, v),
    face([-1, 0, 0], [p0, p4, p7, p3], u, v + d, u + d, v + d + h),
    face([0, 0, -1], [p1, p0, p3, p2], u + d, v + d, u + d + w, v + d + h),
    face([1, 0, 0], [p5, p1, p2, p6], u + d + w, v + d, u + d + w + d, v + d + h),
    face([0, 0, 1], [p4, p5, p6, p7], u + d + w + d, v + d, u + d + w + d + w, v + d + h),
  ];
}

/** Every face of the chest, facing +z. */
export const CHEST_FACES: readonly ChestFace[] = CHEST_BOXES.flatMap(boxFaces);

/** Turns a point of the cell (in blocks, 0..1) about its middle so the front faces `facing`. */
export function turnInCell([x, y, z]: readonly [number, number, number], facing: number): [number, number, number] {
  const dx = x - 0.5;
  const dz = z - 0.5;
  // +z, -x, -z, +x: a quarter turn each
  switch (facing & 3) {
    case 1: return [0.5 - dz, y, 0.5 + dx];
    case 2: return [0.5 - dx, y, 0.5 - dz];
    case 3: return [0.5 + dz, y, 0.5 - dx];
    default: return [x, y, z];
  }
}

/** A direction turned the same way (a face's normal). */
export function turnVector([x, y, z]: readonly [number, number, number], facing: number): [number, number, number] {
  const [tx, , tz] = turnInCell([x + 0.5, 0, z + 0.5], facing);
  return [tx - 0.5, y, tz - 0.5];
}

export const isChest = (block: number): block is typeof BLOCK.chest | typeof BLOCK.creativeChest =>
  block === BLOCK.chest || block === BLOCK.creativeChest;

/** A chest's texture as one side of it looks from outside (16×16, see-through round the chest): what an
 * item's icon and a held chest show on their cube. `view` is the side looked at, facing +z. */
export function chestSidePixels(texture: ImageData, view: 'top' | 'front' | 'side'): ImageData {
  const out = new ImageData(16, 16);
  const normal: [number, number, number] = view === 'top' ? [0, 1, 0] : view === 'front' ? [0, 0, 1] : [1, 0, 0];
  for (const face of CHEST_FACES) {
    if (face.normal[0] !== normal[0] || face.normal[1] !== normal[1] || face.normal[2] !== normal[2]) continue;
    // the face spans its corners' box; each of its pixels takes the texture's by bilinear corners
    const [c0, c1, , c3] = face.corners;
    const [t0, t1, , t3] = face.uvs;
    const axisS = [0, 1, 2].find((i) => c1![i] !== c0![i])!;
    const axisT = [0, 1, 2].find((i) => c3![i] !== c0![i])!;
    const lengthS = c1![axisS]! - c0![axisS]!;
    const lengthT = c3![axisT]! - c0![axisT]!;
    for (let s = 0.5; s < Math.abs(lengthS); s++) {
      for (let t = 0.5; t < Math.abs(lengthT); t++) {
        const fs = s / Math.abs(lengthS);
        const ft = t / Math.abs(lengthT);
        const point = [...c0!] as [number, number, number];
        point[axisS] += Math.sign(lengthS) * s;
        point[axisT] += Math.sign(lengthT) * t;
        const tu = t0![0] + (t1![0] - t0![0]) * fs + (t3![0] - t0![0]) * ft;
        const tv = t0![1] + (t1![1] - t0![1]) * fs + (t3![1] - t0![1]) * ft;
        // the icon looks at the side from outside: top with north up, front and side upright
        const [px, py] = view === 'top' ? [point[0], point[2]] : view === 'front' ? [point[0], 16 - point[1]] : [16 - point[2], 16 - point[1]];
        const ix = Math.floor(px);
        const iy = Math.floor(py);
        if (ix < 0 || ix > 15 || iy < 0 || iy > 15) continue;
        const from = (Math.floor(tv) * texture.width + Math.floor(tu)) * 4;
        const to = (iy * 16 + ix) * 4;
        for (let c = 0; c < 4; c++) out.data[to + c] = texture.data[from + c]!;
      }
    }
  }
  return out;
}

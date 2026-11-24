import { BLOCK } from '@game/blocks';

// A chest drawn from the block game's chest model: three boxes, a body, its
// lid and the latch, painted from a 64×64 entity texture (Kenui's Default's
// entity/chest/normal.png; the creative chest wears its ender.png). Each box
// takes its faces from the texture the way the game's model boxes do: from a
// corner (u, v), the box's depth, width and height side by side, and the game
// draws the 1.15+ textures turned half round, as here. The front faces +z
// before the block's state turns it (game/blocks.ts: +z, -x, -z, +x).
//
// The game's chest is 14 pixels, a pixel in from the cell's sides; here the
// body and lid are stretched to fill the whole cell, so a chest is as big as
// the blocks round it and its item's cube has no see-through rim. The latch
// keeps its pixel of depth and stands out of the front.

/** a box: where it sits in the game's model (pixels), and its texture's corner */
interface ChestBox { min: [number, number, number]; max: [number, number, number]; u: number; v: number }

/** the game's single chest: the body, the lid on it, the latch on the lid's front */
const CHEST_BOXES: readonly ChestBox[] = [
  { min: [1, 0, 1], max: [15, 10, 15], u: 0, v: 19 },
  { min: [1, 9, 1], max: [15, 14, 15], u: 0, v: 0 },
  { min: [7, 7, 15], max: [9, 11, 16], u: 0, v: 0 },
];

/** how much the 14-pixel model grows to fill the cell */
const STRETCH = 16 / 14;

/** A point of the game's model where it sits in the cell (pixels): out from the middle across, up from the
 * floor, and the latch (past the body's front) pushed out by as much as the front moved. */
function placed([x, y, z]: readonly [number, number, number]): [number, number, number] {
  const across = (p: number) => 8 + (p - 8) * STRETCH;
  return [across(x), y * STRETCH, z > 15 ? z + 1 : across(z)];
}

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
    ({ normal, corners: corners.map(placed), uvs: [[u2, v1], [u1, v1], [u1, v2], [u2, v2]] });
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

/** A chest's texture as one side of it looks from outside (16×16, the cell filled edge to edge): what an
 * item's icon and a held chest show on their cube. `view` is the side looked at, facing +z. */
export function chestSidePixels(texture: ImageData, view: 'top' | 'front' | 'side'): ImageData {
  const out = new ImageData(16, 16);
  const normal: [number, number, number] = view === 'top' ? [0, 1, 0] : view === 'front' ? [0, 0, 1] : [1, 0, 0];
  // where a pixel of the icon looks into the cell: top with north up, front and side upright
  const inCell = (px: number, py: number): [number, number, number] =>
    view === 'top' ? [px, 16, py] : view === 'front' ? [px, 16 - py, 16] : [16, 16 - py, 16 - px];
  for (const face of CHEST_FACES) {
    if (face.normal[0] !== normal[0] || face.normal[1] !== normal[1] || face.normal[2] !== normal[2]) continue;
    // the face spans its corners' box; each pixel's middle finds how far along it is, and takes the
    // texture's pixel there (the faces drawn later, the lid's and the latch's, cover the body's)
    const [c0, c1, , c3] = face.corners;
    const [t0, t1, , t3] = face.uvs;
    const axisS = [0, 1, 2].find((i) => c1![i] !== c0![i])!;
    const axisT = [0, 1, 2].find((i) => c3![i] !== c0![i])!;
    for (let iy = 0; iy < 16; iy++) {
      for (let ix = 0; ix < 16; ix++) {
        const point = inCell(ix + 0.5, iy + 0.5);
        const fs = (point[axisS] - c0![axisS]!) / (c1![axisS]! - c0![axisS]!);
        const ft = (point[axisT] - c0![axisT]!) / (c3![axisT]! - c0![axisT]!);
        if (fs < 0 || fs >= 1 || ft < 0 || ft >= 1) continue;
        const tu = t0![0] + (t1![0] - t0![0]) * fs + (t3![0] - t0![0]) * ft;
        const tv = t0![1] + (t1![1] - t0![1]) * fs + (t3![1] - t0![1]) * ft;
        const from = (Math.floor(tv) * texture.width + Math.floor(tu)) * 4;
        const to = (iy * 16 + ix) * 4;
        for (let c = 0; c < 4; c++) out.data[to + c] = texture.data[from + c]!;
      }
    }
  }
  return out;
}

import { BLOCK, LANTERN, TORCH_ON_FLOOR, TORCH_ON_WALL } from '@game/blocks';
import { turnInCell, turnVector } from './chestModel';

// Torches and lanterns as the block game draws them: not cubes but a few boxes
// each, written the way the game's block models are (elements from one corner
// to the other in pixels, an optional tilt about a point, and for each face
// the rectangle of the 16×16 texture it shows). The torch is Kenui's Default's
// (models/block/template_torch.json and template_torch_wall.json: a stick with
// a flame box round its tip, leaning out of a wall); the lantern, standing or
// hanging, is the game's (template_lantern.json, template_hanging_lantern.json):
// a body, its cap and a handle of two crossed planes. A wall torch's model
// leans toward +x; its state turns it to point away from its wall.

type Vec3 = [number, number, number];
type Direction = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';
/** a face's rectangle of the texture, in pixels: u1, v1, u2, v2 (either way round, as the game allows) */
type Rect = [number, number, number, number];

interface Element {
  from: Vec3;
  to: Vec3;
  rotation?: { axis: 'y' | 'z'; angle: number; origin: readonly [number, number, number] };
  faces: Partial<Record<Direction, Rect>>;
}

/** A face of a model: its four corners in the cell (0..1), their texture pixels, which way it faces, and
 * whether it takes the fixed shade of that way (a torch's do not). */
export interface ModelFace {
  normal: Vec3;
  corners: Vec3[];
  uvs: [number, number][];
  shade: boolean;
}

const sides = (rect: Rect): Partial<Record<Direction, Rect>> => ({ north: rect, south: rect, west: rect, east: rect });
const all = (rect: Rect): Partial<Record<Direction, Rect>> => ({ ...sides(rect), up: rect, down: rect });

const TORCH_STICK: Rect = [7, 6, 9, 16];
const TORCH_FLAME: Rect = [6, 5, 7, 6];

const FLOOR_TORCH: Element[] = [
  { from: [7, 0, 7], to: [9, 10, 9], faces: { ...sides(TORCH_STICK), up: [7, 6, 9, 8] } },
  { from: [6.5, 7.5, 6.5], to: [9.5, 10.5, 9.5], faces: all(TORCH_FLAME) },
];

const WALL_TILT = { axis: 'z', angle: -22.5, origin: [0, 3.5, 8] } as const;
const WALL_TORCH: Element[] = [
  { from: [-1, 3.5, 7], to: [1, 13.5, 9], rotation: WALL_TILT, faces: { ...sides(TORCH_STICK), up: [7, 6, 9, 8], down: [7, 13, 9, 15] } },
  { from: [-1.5, 11, 6.5], to: [1.5, 14, 9.5], rotation: WALL_TILT, faces: all(TORCH_FLAME) },
];

/** A lantern whose body starts `lift` pixels up, with a handle (or, hanging, a chain) from `handle`. */
function lantern(hanging: boolean): Element[] {
  const lift = hanging ? 1 : 0;
  const turn = { axis: 'y', angle: 45, origin: [8, 8, 8] } as const;
  return [
    { from: [5, lift, 5], to: [11, 7 + lift, 11], faces: { ...sides([0, 2, 6, 9]), up: [0, 9, 6, 15], down: [0, 9, 6, 15] } },
    { from: [6, 7 + lift, 6], to: [10, 9 + lift, 10], faces: { ...sides([1, 0, 5, 2]), up: [1, 10, 5, 14] } },
    hanging
      ? { from: [6.5, 11, 8], to: [9.5, 15, 8], rotation: turn, faces: { north: [14, 1, 11, 5], south: [11, 1, 14, 5] } }
      : { from: [6.5, 9, 8], to: [9.5, 11, 8], rotation: turn, faces: { north: [14, 1, 11, 3], south: [11, 1, 14, 3] } },
    hanging
      ? { from: [8, 10, 6.5], to: [8, 16, 9.5], rotation: turn, faces: { west: [14, 6, 11, 12], east: [11, 6, 14, 12] } }
      : { from: [8, 9, 6.5], to: [8, 11, 9.5], rotation: turn, faces: { west: [14, 10, 11, 12], east: [11, 10, 14, 12] } },
  ];
}

/** Each face's way out, and the two ways its texture's u and v run across it (seen from outside, v down),
 * as the game maps a face's rectangle onto it. Axes 0, 1, 2 are x, y, z. */
const FACE_AXES: Record<Direction, { normal: Vec3; u: [axis: number, sign: number]; v: [axis: number, sign: number] }> = {
  down: { normal: [0, -1, 0], u: [0, 1], v: [2, -1] },
  up: { normal: [0, 1, 0], u: [0, 1], v: [2, 1] },
  north: { normal: [0, 0, -1], u: [0, -1], v: [1, -1] },
  south: { normal: [0, 0, 1], u: [0, 1], v: [1, -1] },
  west: { normal: [-1, 0, 0], u: [2, 1], v: [1, -1] },
  east: { normal: [1, 0, 0], u: [2, -1], v: [1, -1] },
};

function rotate(point: Vec3, rotation: Element['rotation'], isVector = false): Vec3 {
  if (!rotation) return point;
  const angle = (rotation.angle * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const [ox, oy, oz] = isVector ? [0, 0, 0] : rotation.origin;
  const [x, y, z] = [point[0] - ox, point[1] - oy, point[2] - oz];
  if (rotation.axis === 'y') return [ox + x * cos + z * sin, oy + y, oz - x * sin + z * cos];
  return [ox + x * cos - y * sin, oy + x * sin + y * cos, oz + z];
}

/** The faces of an element, in the cell's units, turned a quarter `turn` times about the cell's middle. */
function elementFaces(element: Element, shade: boolean, turn: number): ModelFace[] {
  const min: Vec3 = [0, 1, 2].map((i) => Math.min(element.from[i]!, element.to[i]!)) as Vec3;
  const max: Vec3 = [0, 1, 2].map((i) => Math.max(element.from[i]!, element.to[i]!)) as Vec3;
  return (Object.entries(element.faces) as [Direction, Rect][]).map(([direction, [u1, v1, u2, v2]]) => {
    const { normal, u, v } = FACE_AXES[direction];
    // the corner where u and v start, then a step along each
    const start: Vec3 = [0, 1, 2].map((i) => (normal[i]! > 0 ? max[i]! : normal[i]! < 0 ? min[i]! : 0)) as Vec3;
    start[u[0]] = u[1] > 0 ? min[u[0]]! : max[u[0]]!;
    start[v[0]] = v[1] > 0 ? min[v[0]]! : max[v[0]]!;
    const corners: Vec3[] = [];
    const uvs: [number, number][] = [];
    for (const [s, t] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      const corner = [...start] as Vec3;
      corner[u[0]] += s * u[1] * (max[u[0]]! - min[u[0]]!);
      corner[v[0]] += t * v[1] * (max[v[0]]! - min[v[0]]!);
      const [x, y, z] = rotate(corner, element.rotation);
      corners.push(turnInCell([x / 16, y / 16, z / 16], turn));
      uvs.push([u1 + s * (u2 - u1), v1 + t * (v2 - v1)]);
    }
    return { normal: turnVector(rotate(normal, element.rotation, true), turn), corners, uvs, shade };
  });
}

export const hasModel = (block: number): boolean => block === BLOCK.torch || block === BLOCK.lantern;

const cache = new Map<string, readonly ModelFace[]>();

/** The faces of a torch or lantern in its state. */
export function modelFaces(block: typeof BLOCK.torch | typeof BLOCK.lantern, state: number): readonly ModelFace[] {
  const key = `${block}:${state}`;
  let faces = cache.get(key);
  if (!faces) {
    if (block === BLOCK.torch) {
      const onWall = state !== TORCH_ON_FLOOR;
      // the wall model points +x (facing 3); turning by facing + 1 quarters brings it round to the state's
      const turn = onWall ? ((state - TORCH_ON_WALL + 1) & 3) : 0;
      faces = (onWall ? WALL_TORCH : FLOOR_TORCH).flatMap((element) => elementFaces(element, false, turn));
    } else {
      faces = lantern(state === LANTERN.hanging).flatMap((element) => elementFaces(element, true, 0));
    }
    cache.set(key, faces);
  }
  return faces;
}


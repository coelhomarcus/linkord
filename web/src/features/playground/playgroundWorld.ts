// The playground's fixed layout, shared by the 3D scene (engine/) and by the
// parts that never load three.js: the session that clamps what peers send and
// the spawn point. Units are blocks (a block is a metre); +y is up, the big
// screen stands at -z. The island itself is islandMap.ts.

/** Height of the plaza's surface, where people arrive. */
export const PLAZA_HEIGHT = 7;
/** Nobody stands outside this square around the origin (the map's edge). */
export const WORLD_RADIUS = 36;
/** Highest anyone can be: the top of the map. */
export const MAX_HEIGHT = 24;

export const SCREEN = {
  /** centre of the picture, just in front of its block wall */
  x: 0, y: PLAZA_HEIGHT + 5, z: -17,
  width: 12, height: 6.75,
} as const;

const SPAWN_RADIUS = 4;
const SPAWN_CENTER_Z = 2;

/** Where a participant first appears: a spot on a ring around the plaza,
 * the same for the same connection, so two people joining together do not
 * land inside each other. Facing the screen. */
export function spawnPoint(participantId: string): { x: number; y: number; z: number; yaw: number } {
  const angle = (hashString(participantId) % 360) * (Math.PI / 180);
  return { x: Math.cos(angle) * SPAWN_RADIUS, y: PLAZA_HEIGHT, z: SPAWN_CENTER_Z + Math.sin(angle) * SPAWN_RADIUS, yaw: Math.PI };
}

/** FNV-1a: a stable, well spread number from an id. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

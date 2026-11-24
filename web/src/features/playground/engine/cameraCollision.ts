import type { Terrain } from './playerPhysics';

// A third-person camera sits on the line through the eyes, behind (or in front
// of) the head, and moves in when a block is in the way, so the view never ends
// up inside one. Same distances as minecraft-renderer's getThirdPersonCamera
// (github.com/zardoy/minecraft-web-client, MIT, Copyright (c) 2020
// PrismarineJS); we march along the line against the block cells instead of
// traversing a voxel grid.

/** the lens keeps this far from any block face */
const CAMERA_RADIUS = 0.25;
/** and at least this far from the eyes, so it never sits inside the head */
const MIN_DISTANCE = 0.4;
const STEP = 0.05;

function solidAt(terrain: Terrain, x: number, y: number, z: number): boolean {
  for (const dx of [-CAMERA_RADIUS, CAMERA_RADIUS]) {
    for (const dy of [-CAMERA_RADIUS, CAMERA_RADIUS]) {
      for (const dz of [-CAMERA_RADIUS, CAMERA_RADIUS]) {
        if (terrain.isSolid(Math.floor(x + dx), Math.floor(y + dy), Math.floor(z + dz))) return true;
      }
    }
  }
  return false;
}

/** How far from `eye` along `direction` (a unit vector) the camera can go, up to `max`. */
export function cameraDistance(terrain: Terrain, eye: { x: number; y: number; z: number }, direction: { x: number; y: number; z: number }, max: number): number {
  for (let t = STEP; t <= max; t += STEP) {
    if (solidAt(terrain, eye.x + direction.x * t, eye.y + direction.y * t, eye.z + direction.z * t)) {
      return Math.max(MIN_DISTANCE, t - STEP);
    }
  }
  return max;
}

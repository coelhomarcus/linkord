// The sway of a first-person view while walking: the camera dips with each
// step and rolls a little side to side, and the arm bobs with it. Driven by how
// far the player walked, so it slows with the feet and stops in the air.
//
// Ported from minecraft-web-client and minecraft-renderer
// (github.com/zardoy/minecraft-web-client, MIT, Copyright (c) 2020 PrismarineJS):
// updateMountedBobState and computeCameraBob.

const DEG = Math.PI / 180;

export interface BobState {
  walkDist: number;
  prevWalkDist: number;
  bob: number;
  prevBob: number;
}

export interface Bob {
  /** camera offset along its own right and up, in blocks */
  x: number;
  y: number;
  /** extra rotation about the camera's x and z axes, radians */
  pitch: number;
  roll: number;
}

export function createBobState(): BobState {
  return { walkDist: 0, prevWalkDist: 0, bob: 0, prevBob: 0 };
}

/** One physics tick: `moved` is the horizontal distance covered in it. */
export function tickBob(state: BobState, moved: number, onGround: boolean): void {
  state.prevWalkDist = state.walkDist;
  state.prevBob = state.bob;
  state.walkDist += moved * 0.6;
  const target = onGround ? Math.min(0.1, moved) : 0;
  state.bob += (target - state.bob) * 0.4;
}

/** The bob between two ticks (`partial` 0..1). The arm in first person sways with the same one, as
 * in the original: one step of the sway per 1.67 blocks walked, whether walking or sprinting. */
export function computeBob(state: BobState, partial: number): Bob {
  const { walkDist } = state;
  const delta = walkDist - state.prevWalkDist;
  // the original interpolates backwards, from the newer tick
  const walked = -(walkDist + delta * partial);
  const bob = state.prevBob + (state.bob - state.prevBob) * partial;
  const sin = Math.sin(walked * Math.PI);
  const cos = Math.cos(walked * Math.PI);
  return {
    x: sin * bob * 0.5,
    y: -Math.abs(cos * bob),
    pitch: Math.abs(Math.cos(walked * Math.PI - 0.2) * bob) * 5 * DEG,
    roll: sin * bob * 3 * DEG,
  };
}

import { MAX_LIGHT } from '@game/light';

// How bright each corner of a block face is, the block game's way: the light
// of the cells around it (game/light.ts, sky light and block light), averaged
// over the cells around the corner (smooth lighting) and darkened where blocks
// meet (ambient occlusion), and each direction has its fixed shade.
//
// The rules and constants are minecraft-renderer's mesher (vertexShading.ts and
// models.ts in github.com/zardoy/minecraft-web-client, MIT, Copyright (c) 2020
// PrismarineJS), with its default lightmap.

const MIN_BRIGHTNESS = 0.12;

/** The default lightmap: a light level (0..1) to a brightness, never fully black. */
export function lightmap(level: number): number {
  return MIN_BRIGHTNESS + level * (1 - MIN_BRIGHTNESS);
}

/** The fixed shade of a face by the way it points: tops full, bottoms half, east/west dimmest. */
export function sideShade(dx: number, dy: number, dz: number): number {
  return 0.75 + 0.25 * dy + 0.05 * (Math.abs(dz) - 3 * Math.abs(dx));
}

/** Ambient occlusion of a face corner, 0 (both sides blocked) to 3 (open). */
export function cornerOcclusion(side1: boolean, side2: boolean, corner: boolean): number {
  if (side1 && side2) return 0;
  return 3 - Number(side1) - Number(side2) - Number(corner);
}

/** How bright one corner of a face is: its shade, its occlusion and the light around it. */
export function cornerBrightness(shade: number, occlusion: number, light: number): number {
  return shade * (occlusion * 0.2 + 0.4) * lightmap(light / MAX_LIGHT);
}

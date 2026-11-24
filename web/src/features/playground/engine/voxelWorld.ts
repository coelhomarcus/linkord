import * as THREE from 'three';
import { BLOCK, blockDef } from '@game/blocks';
import type { Block } from '@game/blocks';
import type { BlockGrid } from '@game/grid';
import { HALF, HEIGHT, SCREEN, SEA_LEVEL, SIZE } from '@game/layout';
import type { WorldState } from '../worldState';
import { BlockLight, MAX_LIGHT, ScreenLight, SkyLight } from '@game/light';
import type { LightChange } from '@game/light';
import { applyPackTiles, blockAtlas, chestUv, faceTile, faceTurned, packLantern, packWater, tileUv, waterTexture } from './blockTextures';
import { hasModel, modelFaces } from './blockModels';
import { CHEST_FACES, isChest, turnInCell, turnVector } from './chestModel';
import { Clouds } from './clouds';
import { cornerBrightness, cornerOcclusion, lightmap, sideShade } from './lighting';
import { glowAt, GLOW_ZONES, type Rgb } from './screenGlow';
import { Sky, sunDirection } from './sky';
import { daylight, MAX_SKY_DARKEN, skyDarken } from '@game/dayTime';

// The world as meshes of 16×16-column chunks: only faces that touch something
// see-through are built (the three.js manual's voxel geometry), and a change
// rebuilds only the chunks whose blocks or light it touched. Each corner
// carries its shade and ambient occlusion and the sky light and block light
// averaged around it (game/light.ts, lighting.ts); the shader darkens the sky
// light with the time of day (game/dayTime.ts: 15 by day is 4 at night, a
// little blue), so a sunset needs no rebuilding, and takes the brighter of it
// and the block light, warm as torchlight is. The big screen's light is a third
// value per corner (game/light.ts's ScreenLight) that the shader multiplies by
// the colour on the screen (screenGlow.ts), uniforms that change without a
// rebuild, and adds on top. Torches and lanterns are their
// models (blockModels.ts), lit by their own cell. The sun, moving across the sky (sky.ts), casts shadows on top: a
// shadow map, as minecraft-renderer's sun shadows (github.com/zardoy/
// minecraft-web-client, MIT, Copyright (c) 2020 PrismarineJS) do it, taking sky
// light down to 60% where the sun does not reach, including faces turned away
// from it. Water is its own see-through mesh per chunk, its surface a little
// under the top of its cells, and the sea goes on past the world's edge as a
// plane. No other lighting: the pixel art's colours stay as painted.

const FOG = { near: 48, far: 140 } as const;
/** under water the view closes in, blue */
const WATER_FOG = { color: 0x1d3f8a, near: 0.5, far: 14 } as const;
const CHUNK = 16;
const CHUNKS = SIZE / CHUNK;
/** how long a frame may spend rebuilding chunks (ms); the rest wait for the next frame */
const BUILD_BUDGET_MS = 8;
/** a water cell's surface, when nothing but air is over it */
const WATER_TOP = 0.875;
const WATER_OPACITY = 0.8;
/** the sun's distance from the island's middle, for its shadow camera */
const SUN_DISTANCE = 110;

/** Light by face direction: +x, -x, +y, -y, +z, -z (the avatars' boxes use it too). */
export const FACE_SHADE = [sideShade(1, 0, 0), sideShade(-1, 0, 0), sideShade(0, 1, 0), sideShade(0, -1, 0), sideShade(0, 0, 1), sideShade(0, 0, -1)] as const;

/** What is left of the sky's light in the sun's shadow. */
const SHADOWED_SKY_LIGHT = 0.6;
/** how high the sun must be (the y of the way to it) for its shadows to start and to be full: low
 * shadows would be endless, and at night there are none */
const SHADOW_FROM = 0.08;
const SHADOW_FULL = 0.3;
/** the moonlight's colour, which the sky's light takes on as it darkens */
const NIGHT_TINT = new THREE.Color(0.78, 0.82, 1);
/** how strong the big screen's light is by day and at night: a hint in the sun, clear in the dark */
const SCREEN_GLOW = { day: 0.15, night: 0.9 } as const;
/** an averaged picture is a dim colour: its light is brought up by this much (and kept under 1) */
const SCREEN_GLOW_GAIN = 2.5;

/** How bright light of `level` (0..15) is with the sky darkened by `darken` steps: the sky light a
 * block face or a person gets now. */
export function darkenedLight(level: number, darken: number): number {
  return lightmap(Math.max(0, level - darken) / MAX_LIGHT);
}

// corner positions and their uv, after the three.js manual's voxel geometry
const FACES = [
  { dir: [1, 0, 0], shade: FACE_SHADE[0], corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [-1, 0, 0], shade: FACE_SHADE[1], corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [0, 1, 0], shade: FACE_SHADE[2], corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, -1, 0], shade: FACE_SHADE[3], corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 0, 1], shade: FACE_SHADE[4], corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
  { dir: [0, 0, -1], shade: FACE_SHADE[5], corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
] as const;

/** Blocks that cast ambient occlusion and stop smooth light: anything solid (leaves let light through). */
const occludes = (block: number) => blockDef(block).solid;
const opaque = (block: number) => blockDef(block).opaque;

/** Whether a face of `block` toward `neighbour` is seen: not behind something opaque, nor between two
 * panes of glass or two cells of water. */
function faceShown(block: Block, neighbour: Block): boolean {
  if (opaque(neighbour)) return false;
  if (block === neighbour && (block === BLOCK.glass || block === BLOCK.water)) return false;
  return true;
}

/** `colors` is a corner's shade and occlusion, `light`, `blockLight` and `screenLight` the sky, block and
 * screen light around it (0..1) */
interface Arrays { positions: number[]; normals: number[]; uvs: number[]; colors: number[]; light: number[]; blockLight: number[]; screenLight: number[]; indices: number[] }
const arrays = (): Arrays => ({ positions: [], normals: [], uvs: [], colors: [], light: [], blockLight: [], screenLight: [], indices: [] });

/** Every channel of the world's light. */
interface Light { sky: SkyLight; block: BlockLight; screen: ScreenLight }

/** The light of one cell, 0..15 a channel. */
interface CellLight { sky: number; block: number; screen: number }
const cellLight = (light: Light, x: number, y: number, z: number): CellLight =>
  ({ sky: light.sky.at(x, y, z), block: light.block.at(x, y, z), screen: light.screen.at(x, y, z) });

function pushLight(out: Arrays, { sky, block, screen }: CellLight): void {
  out.light.push(sky / MAX_LIGHT);
  out.blockLight.push(block / MAX_LIGHT);
  out.screenLight.push(screen / MAX_LIGHT);
}

function toGeometry({ positions, normals, uvs, colors, light, blockLight, screenLight, indices }: Arrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('skyLight', new THREE.Float32BufferAttribute(light, 1));
  geometry.setAttribute('blockLight', new THREE.Float32BufferAttribute(blockLight, 1));
  geometry.setAttribute('screenLight', new THREE.Float32BufferAttribute(screenLight, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** The faces of one chunk: its blocks, and its water apart. */
function chunkGeometry(grid: BlockGrid, light: Light, world: WorldState, cx: number, cz: number): { blocks: Arrays; water: Arrays } {
  const { sky } = light;
  const blocks = arrays();
  const water = arrays();
  const x0 = -HALF + cx * CHUNK;
  const z0 = -HALF + cz * CHUNK;
  for (let x = x0; x < x0 + CHUNK; x++) {
    for (let z = z0; z < z0 + CHUNK; z++) {
      for (let y = 0; y < HEIGHT; y++) {
        const block = grid.get(x, y, z);
        if (block === BLOCK.air) continue;
        if (block === BLOCK.water) {
          waterFaces(grid, light, water, x, y, z);
          continue;
        }
        const furnace = block === BLOCK.furnace ? world.furnaceAt(x, y, z) ?? undefined : undefined;
        const state = grid.stateAt(x, y, z);
        if (isChest(block)) {
          chestFaces(blocks, block, state, cellLight(light, x, y, z), x, y, z);
          continue;
        }
        if (hasModel(block)) {
          modelFacesInto(blocks, block as typeof BLOCK.torch | typeof BLOCK.lantern, state, cellLight(light, x, y, z), x, y, z);
          continue;
        }
        FACES.forEach((face, faceIndex) => {
          const [dx, dy, dz] = face.dir;
          if (!faceShown(block, grid.get(x + dx, y + dy, z + dz))) return;
          const tile = tileUv(faceTile(block, faceIndex, furnace, state));
          const turned = faceTurned(block, faceIndex, state);
          const start = blocks.positions.length / 3;
          // the cell in front of the face, where its light comes from
          const fx = x + dx;
          const fy = y + dy;
          const fz = z + dz;
          const brightness: number[] = [];
          for (const [cx2, cy, cz2, cu, cv] of face.corners) {
            blocks.positions.push(x + cx2, y + cy, z + cz2);
            blocks.normals.push(dx, dy, dz);
            // a quarter turn: what ran along u runs along v
            const [tu, tv] = turned ? [cv, 1 - cu] : [cu, cv];
            blocks.uvs.push(tu ? tile.u1 : tile.u0, tv ? tile.v1 : tile.v0);
            // the corner's two neighbours along the face, and the one diagonal between them
            const sx = dx === 0 ? cx2 * 2 - 1 : 0;
            const sy = dy === 0 ? cy * 2 - 1 : 0;
            const sz = dz === 0 ? cz2 * 2 - 1 : 0;
            const [a, b] = sx === 0 ? [[0, sy, 0], [0, 0, sz]] : sy === 0 ? [[sx, 0, 0], [0, 0, sz]] : [[sx, 0, 0], [0, sy, 0]];
            const cells = [[fx, fy, fz], [fx + a![0]!, fy + a![1]!, fz + a![2]!], [fx + b![0]!, fy + b![1]!, fz + b![2]!], [fx + sx, fy + sy, fz + sz]] as const;
            const [, side1, side2, corner] = cells.map(([bx, by, bz]) => grid.get(bx, by, bz));
            const occlusion = cornerOcclusion(occludes(side1!), occludes(side2!), occludes(corner!));
            // smooth light: the cells around the corner that light can be in
            let skyLight = 0;
            let blockLight = 0;
            let screenLight = 0;
            let lit = 0;
            cells.forEach(([bx, by, bz], index) => {
              if (index > 0 && opaque(grid.get(bx, by, bz))) return;
              skyLight += sky.at(bx, by, bz);
              blockLight += light.block.at(bx, by, bz);
              screenLight += light.screen.at(bx, by, bz);
              lit++;
            });
            const level = lit ? skyLight / lit : MAX_LIGHT;
            const blockLevel = lit ? blockLight / lit : 0;
            brightness.push(cornerBrightness(face.shade, occlusion, Math.max(level, blockLevel)));
            const shade = cornerBrightness(face.shade, occlusion, MAX_LIGHT);
            blocks.colors.push(shade, shade, shade);
            pushLight(blocks, { sky: level, block: blockLevel, screen: lit ? screenLight / lit : 0 });
          }
          // split the quad along its brighter diagonal, or the occlusion shows a seam across it
          if (brightness[0]! + brightness[3]! > brightness[1]! + brightness[2]!) {
            blocks.indices.push(start, start + 1, start + 3, start, start + 3, start + 2);
          } else {
            blocks.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
          }
        });
      }
    }
  }
  return { blocks, water };
}

/** The face direction (FACES' index) nearest a normal. */
function nearestDirection([nx, ny, nz]: readonly [number, number, number]): number {
  const [ax, ay, az] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)];
  if (ax >= ay && ax >= az) return nx > 0 ? 0 : 1;
  if (ay >= az) return ny > 0 ? 2 : 3;
  return nz > 0 ? 4 : 5;
}

/** Two triangles over a face's four corners, the way round whose front is outside. */
function pushQuad(out: Arrays, start: number, corners: readonly (readonly [number, number, number])[], [nx, ny, nz]: readonly [number, number, number]): void {
  const [a, b, c] = corners;
  const e1 = [b![0] - a![0], b![1] - a![1], b![2] - a![2]];
  const e2 = [c![0] - a![0], c![1] - a![1], c![2] - a![2]];
  const outward = (e1[1]! * e2[2]! - e1[2]! * e2[1]!) * nx + (e1[2]! * e2[0]! - e1[0]! * e2[2]!) * ny + (e1[0]! * e2[1]! - e1[1]! * e2[0]!) * nz > 0;
  if (outward) out.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  else out.indices.push(start, start + 2, start + 1, start, start + 3, start + 2);
}

/** A torch's or lantern's model (blockModels.ts) in its state, lit by the light of its own cell; a
 * lantern's faces get the fixed shade of the way they point, a torch's none, as in the game. */
function modelFacesInto(out: Arrays, block: typeof BLOCK.torch | typeof BLOCK.lantern, state: number, light: CellLight, x: number, y: number, z: number): void {
  const tile = tileUv(faceTile(block, 0, undefined, state));
  for (const face of modelFaces(block, state)) {
    const start = out.positions.length / 3;
    const shade = face.shade ? FACES[nearestDirection(face.normal)]!.shade : 1;
    // a hair in from the texel's edge, so the nearest one is always the face's own
    const [cu, cv] = face.uvs.reduce(([su, sv], [u, v]) => [su + u / 4, sv + v / 4], [0, 0]);
    face.corners.forEach(([cx, cy, cz], i) => {
      out.positions.push(x + cx, y + cy, z + cz);
      out.normals.push(...face.normal);
      const [pu, pv] = face.uvs[i]!;
      const u = (pu + Math.sign(cu - pu) * 0.01) / 16;
      const v = (pv + Math.sign(cv - pv) * 0.01) / 16;
      out.uvs.push(tile.u0 + u * (tile.u1 - tile.u0), tile.v1 - v * (tile.v1 - tile.v0));
      out.colors.push(shade, shade, shade);
      pushLight(out, light);
    });
    pushQuad(out, start, face.corners, face.normal);
  }
}

/** A chest's three boxes (chestModel.ts), turned to face where its state says, lit by the light of its own
 * cell; each face gets the fixed shade of the way it now points. */
function chestFaces(out: Arrays, block: typeof BLOCK.chest | typeof BLOCK.creativeChest, state: number, light: CellLight, x: number, y: number, z: number): void {
  for (const face of CHEST_FACES) {
    const start = out.positions.length / 3;
    const normal = turnVector(face.normal, state);
    const [nx, ny, nz] = normal;
    const shade = FACES[nearestDirection(normal)]!.shade;
    const corners = face.corners.map(([cx, cy, cz]) => turnInCell([cx / 16, cy / 16, cz / 16], state));
    corners.forEach(([cx, cy, cz], i) => {
      out.positions.push(x + cx, y + cy, z + cz);
      out.normals.push(nx, ny, nz);
      // a hair in from the texel's edge, so the nearest one is always the face's own
      const [tu, tv] = face.uvs[i]!;
      const [cu, cv] = face.uvs.reduce(([su, sv], [u, v]) => [su + u / 4, sv + v / 4], [0, 0]);
      out.uvs.push(...chestUv(block, tu + Math.sign(cu - tu) * 0.01, tv + Math.sign(cv - tv) * 0.01));
      out.colors.push(shade, shade, shade);
      pushLight(out, light);
    });
    // the game's polygons go round either way: keep the one whose front is outside
    pushQuad(out, start, corners, normal);
  }
}

/** A water cell's faces toward air, leaves or glass: its top a little low when open to the sky, so the
 * surface sits under the shore's grass, each face tiled with the water texture in world units. */
function waterFaces(grid: BlockGrid, light: Light, out: Arrays, x: number, y: number, z: number): void {
  const top = grid.get(x, y + 1, z) === BLOCK.water ? 1 : WATER_TOP;
  FACES.forEach((face) => {
    const [dx, dy, dz] = face.dir;
    if (!faceShown(BLOCK.water, grid.get(x + dx, y + dy, z + dz))) return;
    const start = out.positions.length / 3;
    const front = cellLight(light, x + dx, y + dy, z + dz);
    for (const [cx, cy, cz] of face.corners) {
      const py = y + (cy ? top : 0);
      out.positions.push(x + cx, py, z + cz);
      out.normals.push(dx, dy, dz);
      // the texture repeats once a block: tops by x and z, sides along the face and up
      out.uvs.push(dy !== 0 ? x + cx : dx !== 0 ? z + cz : x + cx, dy !== 0 ? z + cz : py);
      out.colors.push(face.shade, face.shade, face.shade);
      pushLight(out, front);
    }
    out.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  });
}

/** The uniforms the time of day and the big screen move, shared by the blocks' and the water's materials. */
interface DayUniforms {
  /** the screen's light at full strength in its left, centre and right zones, already scaled for the time of day */
  screenGlow: { value: THREE.Color[] };
  /** steps the sky light loses now (0..11) */
  skyDarken: { value: number };
  /** the colour the sky's light takes on (white by day) */
  skyTint: { value: THREE.Color };
  /** how strong the sun's shadows are now, 0..1 */
  sunStrength: { value: number };
  sunDirection: { value: THREE.Vector3 };
}

const dayUniforms = (): DayUniforms => ({
  screenGlow: { value: Array.from({ length: GLOW_ZONES }, () => new THREE.Color(0, 0, 0)) },
  skyDarken: { value: 0 },
  skyTint: { value: new THREE.Color(1, 1, 1) },
  sunStrength: { value: 1 },
  sunDirection: { value: new THREE.Vector3(0, 1, 0) },
});

/** The light a corner gets now: its baked sky light (lighting.ts's lightmap, darkened, in `sun` of its
 * strength where the sun's shadow falls) or its block light, whichever is brighter. Block light is warm:
 * white at full, its green and blue falling off faster than its red as it dims, the game's lightmap's
 * torchlight. The big screen's light adds to either, in the colour of the screen's zone nearest along x
 * (screenGlow.ts's glowAt), falling off with the square of its level so it is bright close to the screen
 * and a wall's shadow behind it shows, though the light bends round its edges as block light does. */
const LIGHT_GLSL = /* glsl */ `
  uniform float skyDarken;
  uniform vec3 skyTint;
  uniform vec3 screenGlow[${GLOW_ZONES}];
  vec3 screenLightAt(float screenLight, float x) {
    float t = clamp((x - ${SCREEN.x.toFixed(1)}) / ${(SCREEN.width / 3).toFixed(4)}, -1.0, 1.0);
    vec3 side = t < 0.0 ? screenGlow[0] : screenGlow[2];
    return mix(screenGlow[1], side, abs(t)) * screenLight * screenLight;
  }
  vec3 cornerLight(float skyLight, float blockLight, float sun) {
    float level = max(0.0, skyLight * ${MAX_LIGHT.toFixed(1)} - skyDarken) / ${MAX_LIGHT.toFixed(1)};
    vec3 sky = vec3(${lightmap(0).toFixed(4)} + level * ${(1 - lightmap(0)).toFixed(4)}) * skyTint * sun;
    float b = ${lightmap(0).toFixed(4)} + blockLight * ${(1 - lightmap(0)).toFixed(4)};
    vec3 torch = vec3(b, b * ((b * 0.6 + 0.4) * 0.6 + 0.4), b * (b * b * 0.6 + 0.4));
    return max(sky, torch);
  }
`;

/** The blocks' material, or with `water` the water's: the atlas (or the water's texture, moved by its
 * matrix), each corner's baked shade and sky light, and for blocks the sun's shadow map. */
function blockMaterial(map: THREE.Texture, uniforms: DayUniforms, water = false): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    lights: !water,
    fog: true,
    vertexColors: true,
    transparent: water,
    depthWrite: !water,
    side: water ? THREE.DoubleSide : THREE.FrontSide,
    uniforms: {
      ...THREE.UniformsUtils.merge([water ? {} : THREE.UniformsLib.lights, THREE.UniformsLib.fog, { map: { value: null }, mapTransform: { value: new THREE.Matrix3() } }]),
      ...uniforms,
    },
    defines: { SHADOWED_SKY_LIGHT: SHADOWED_SKY_LIGHT.toFixed(2), ...(water ? { WATER: '' } : {}) },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      #include <shadowmap_pars_vertex>
      uniform mat3 mapTransform;
      attribute float skyLight;
      attribute float blockLight;
      attribute float screenLight;
      varying vec2 vUv;
      varying vec3 vShade;
      varying float vSkyLight;
      varying float vBlockLight;
      varying float vScreenLight;
      varying float vWorldX;
      varying vec3 vWorldNormal;
      void main() {
        vUv = (mapTransform * vec3(uv, 1.0)).xy;
        vShade = color;
        vSkyLight = skyLight;
        vBlockLight = blockLight;
        vScreenLight = screenLight;
        #include <beginnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        #include <project_vertex>
        #include <worldpos_vertex>
        #ifndef WATER
        #include <shadowmap_vertex>
        #endif
        #include <fog_vertex>
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
        vWorldX = (modelMatrix * vec4(transformed, 1.0)).x;
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_fragment>
      #ifndef WATER
      #include <bsdfs>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>
      #endif
      ${LIGHT_GLSL}
      uniform sampler2D map;
      uniform vec3 sunDirection;
      uniform float sunStrength;
      varying vec2 vUv;
      varying vec3 vShade;
      varying float vSkyLight;
      varying float vBlockLight;
      varying float vScreenLight;
      varying float vWorldX;
      varying vec3 vWorldNormal;
      void main() {
        vec4 texel = texture2D(map, vUv);
        #ifdef WATER
        vec3 light = vShade * (cornerLight(vSkyLight, vBlockLight, 1.0) + screenLightAt(vScreenLight, vWorldX));
        gl_FragColor = vec4(texel.rgb * light, texel.a * ${WATER_OPACITY.toFixed(2)});
        #else
        // the holes in the leaves and the glass
        if (texel.a < 0.5) discard;
        // a face turned away from the sun is in its own shadow; one side-on to it, half (the sky's light
        // only: a torch lights a shadow as well as anywhere)
        float facing = smoothstep(-0.15, 0.15, dot(vWorldNormal, sunDirection));
        float sunlit = facing * getShadowMask();
        vec3 light = vShade * (cornerLight(vSkyLight, vBlockLight, mix(1.0, mix(SHADOWED_SKY_LIGHT, 1.0, sunlit), sunStrength)) + screenLightAt(vScreenLight, vWorldX));
        gl_FragColor = vec4(texel.rgb * light, texel.a);
        #endif
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  material.uniforms.map!.value = map;
  return material;
}

/** The sun: only its shadow is used, over the whole world. */
function sunLight(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.castShadow = true;
  const extent = HALF + 8;
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 260 });
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2;
  return sun;
}

/** The sea past the world's edge: a plane with the world cut out of it, at the water's surface. */
function outerSea(material: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape([new THREE.Vector2(-240, -240), new THREE.Vector2(240, -240), new THREE.Vector2(240, 240), new THREE.Vector2(-240, 240)]);
  shape.holes.push(new THREE.Path([new THREE.Vector2(-HALF, -HALF), new THREE.Vector2(-HALF, HALF), new THREE.Vector2(HALF, HALF), new THREE.Vector2(HALF, -HALF)]));
  const geometry = new THREE.ShapeGeometry(shape);
  const sea = new THREE.Mesh(geometry, material);
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = SEA_LEVEL - 1 + WATER_TOP;
  sea.renderOrder = 1;
  return sea;
}

export interface World {
  /** the blocks' pixel art, for the items' cubes */
  readonly atlas: THREE.Texture;
  /** advances what moves on its own: water, clouds, the sky and the sun at the world's `clock` around
   * the `eye`; rebuilds chunks that changed, as time allows */
  update(dt: number, clock: number, eye: THREE.Vector3): void;
  /** how lit a point is now, into `out`: lighting.ts's lightmap of its sky light, darkened at night, or of
   * its block light, whichever is brighter, and the big screen's coloured light on top; to light the people,
   * items and particles there as the blocks around them are */
  lightAt(x: number, y: number, z: number, out: THREE.Color): THREE.Color;
  /** the colour on the big screen now, by zone (screenGlow.ts) */
  setScreenGlow(zones: readonly Rgb[]): void;
  /** blocks that changed: their light is worked out again and the chunks they touch rebuilt */
  blocksChanged(cells: readonly [number, number, number][]): void;
  /** a furnace lit or put out: its block is drawn again */
  furnaceChanged(x: number, z: number): void;
  /** the world arrived again (a reconnect): everything is built anew */
  reload(): void;
  /** how much of the terrain is built since the world (re)arrived, 0..1 */
  buildProgress(): number;
  /** whether the view is under water (the fog closes in) */
  setUnderwater(underwater: boolean): void;
  dispose(): void;
}

interface Chunk { blocks: THREE.Mesh | null; water: THREE.Mesh | null }

export function buildWorld(scene: THREE.Scene, state: WorldState): World {
  const heavens = new Sky();
  scene.add(heavens.group);
  const skyFog = new THREE.Fog(heavens.fogColor, FOG.near, FOG.far);
  const waterFog = new THREE.Fog(WATER_FOG.color, WATER_FOG.near, WATER_FOG.far);
  const waterColor = new THREE.Color(WATER_FOG.color);
  scene.background = null;
  scene.fog = skyFog;

  const day = dayUniforms();
  const atlas = blockAtlas();
  void applyPackTiles(atlas);
  const material = blockMaterial(atlas, day);
  // the sun shines through the holes in the leaves too
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
  const sun = sunLight();
  scene.add(sun, sun.target);

  let stepLantern = (_dt: number) => {};
  void packLantern(atlas).then((step) => { stepLantern = step; });

  const water = waterTexture();
  let stepWater = (_dt: number) => {};
  void packWater(water).then((step) => { stepWater = step; });
  const waterMaterial = blockMaterial(water, day, true);
  const seaMaterial = new THREE.MeshBasicMaterial({ map: water, transparent: true, opacity: 0.84, depthWrite: false });
  const sea = outerSea(seaMaterial);
  scene.add(sea);

  const clouds = new Clouds();
  scene.add(clouds.group);

  /** The sky, the sun and the light at a clock. */
  function followClock(clock: number, eye: THREE.Vector3): void {
    heavens.update(clock, eye);
    const darken = skyDarken(clock);
    day.skyDarken.value = darken;
    day.skyTint.value.setRGB(1, 1, 1).lerp(NIGHT_TINT, darken / MAX_SKY_DARKEN);
    const toSun = sunDirection(clock, day.sunDirection.value);
    day.sunStrength.value = THREE.MathUtils.smoothstep(toSun.y, SHADOW_FROM, SHADOW_FULL);
    sun.position.copy(toSun).multiplyScalar(SUN_DISTANCE);
    const open = darkenedLight(MAX_LIGHT, darken);
    seaMaterial.color.copy(day.skyTint.value).multiplyScalar(open);
    clouds.setDaylight(daylight(clock), day.skyTint.value);
    const strength = THREE.MathUtils.lerp(SCREEN_GLOW.day, SCREEN_GLOW.night, darken / MAX_SKY_DARKEN);
    day.screenGlow.value.forEach((color, zone) => {
      const [r, g, b] = screenZones[zone]!;
      color.setRGB(Math.min(1, r * SCREEN_GLOW_GAIN), Math.min(1, g * SCREEN_GLOW_GAIN), Math.min(1, b * SCREEN_GLOW_GAIN)).multiplyScalar(strength);
    });
  }

  /** the colour on the screen, by zone, as screenGlow.ts last gave it */
  let screenZones: readonly Rgb[] = Array.from({ length: GLOW_ZONES }, (): Rgb => [0, 0, 0]);
  const zoneColors: Rgb[] = day.screenGlow.value.map(() => [0, 0, 0]);
  const glow: Rgb = [0, 0, 0];

  let light: Light | null = null;
  const chunks: Chunk[] = Array.from({ length: CHUNKS * CHUNKS }, () => ({ blocks: null, water: null }));
  const dirty = new Set<number>();

  function disposeChunk(chunk: Chunk): void {
    for (const mesh of [chunk.blocks, chunk.water]) {
      if (!mesh) continue;
      mesh.removeFromParent();
      mesh.geometry.dispose();
    }
    chunk.blocks = null;
    chunk.water = null;
  }

  function buildChunk(index: number): void {
    const grid = state.grid;
    if (!grid || !light) return;
    const cx = Math.floor(index / CHUNKS);
    const cz = index % CHUNKS;
    const chunk = chunks[index]!;
    disposeChunk(chunk);
    const built = chunkGeometry(grid, light, state, cx, cz);
    if (built.blocks.indices.length) {
      const mesh = new THREE.Mesh(toGeometry(built.blocks), material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.customDepthMaterial = depthMaterial;
      scene.add(mesh);
      chunk.blocks = mesh;
    }
    if (built.water.indices.length) {
      const mesh = new THREE.Mesh(toGeometry(built.water), waterMaterial);
      mesh.renderOrder = 1;
      scene.add(mesh);
      chunk.water = mesh;
    }
  }

  /** Marks the chunks a box of cells (grown by one, for the light and shade of the faces around it) touches. */
  function markBox(minX: number, maxX: number, minZ: number, maxZ: number): void {
    const c0 = Math.max(0, Math.floor((minX - 1 + HALF) / CHUNK));
    const c1 = Math.min(CHUNKS - 1, Math.floor((maxX + 1 + HALF) / CHUNK));
    const d0 = Math.max(0, Math.floor((minZ - 1 + HALF) / CHUNK));
    const d1 = Math.min(CHUNKS - 1, Math.floor((maxZ + 1 + HALF) / CHUNK));
    for (let cx = c0; cx <= c1; cx++) for (let cz = d0; cz <= d1; cz++) dirty.add(cx * CHUNKS + cz);
  }

  /** the chunks the arrival of the world left to build */
  let firstBuild = new Set<number>();
  function reload(): void {
    if (!state.grid) return;
    light = { sky: new SkyLight(state.grid), block: new BlockLight(state.grid), screen: new ScreenLight(state.grid) };
    for (let i = 0; i < chunks.length; i++) dirty.add(i);
    firstBuild = new Set(dirty);
  }
  reload();

  return {
    atlas,
    lightAt(x, y, z, out) {
      if (!light) return out.setScalar(darkenedLight(MAX_LIGHT, day.skyDarken.value));
      const [bx, by, bz] = [Math.floor(x), Math.floor(y), Math.floor(z)];
      out.setScalar(Math.max(darkenedLight(light.sky.at(bx, by, bz), day.skyDarken.value), lightmap(light.block.at(bx, by, bz) / MAX_LIGHT)));
      const screen = (light.screen.at(bx, by, bz) / MAX_LIGHT) ** 2;
      if (!screen) return out;
      day.screenGlow.value.forEach((color, zone) => color.toArray(zoneColors[zone]!));
      const [r, g, b] = glowAt(zoneColors, x, glow);
      return out.setRGB(out.r + r * screen, out.g + g * screen, out.b + b * screen);
    },
    setScreenGlow(zones) {
      screenZones = zones;
    },
    blocksChanged(cells) {
      if (!light) return;
      for (const [x, y, z] of cells) {
        markBox(x, x, z, z);
        const changes: (LightChange | null)[] = [light.sky.update(x, z), light.block.update(x, y, z), light.screen.update(x, y, z)];
        for (const change of changes) if (change) markBox(change.minX, change.maxX, change.minZ, change.maxZ);
      }
    },
    furnaceChanged(x, z) {
      markBox(x, x, z, z);
    },
    reload,
    buildProgress: () => (light ? 1 - firstBuild.size / chunks.length : 0),
    setUnderwater(inWater) {
      scene.fog = inWater ? waterFog : skyFog;
      scene.background = inWater ? waterColor : null;
      heavens.group.visible = !inWater;
    },
    update(dt, clock, eye) {
      followClock(clock, eye);
      stepWater(dt);
      stepLantern(dt);
      water.offset.x = (water.offset.x + dt * 0.04) % 1;
      water.offset.y = (water.offset.y + dt * 0.015) % 1;
      water.updateMatrix();
      waterMaterial.uniforms.mapTransform!.value = water.matrix;
      clouds.update(dt);
      const started = performance.now();
      for (const index of dirty) {
        dirty.delete(index);
        firstBuild.delete(index);
        buildChunk(index);
        if (performance.now() - started > BUILD_BUDGET_MS) break;
      }
    },
    dispose() {
      for (const chunk of chunks) disposeChunk(chunk);
      material.dispose();
      depthMaterial.dispose();
      atlas.dispose();
      waterMaterial.dispose();
      seaMaterial.dispose();
      heavens.dispose();
      water.dispose();
      sea.geometry.dispose();
      clouds.group.removeFromParent();
    },
  };
}

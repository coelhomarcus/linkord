import * as THREE from 'three';
import { BLOCK, blockDef } from '@game/blocks';
import type { Block } from '@game/blocks';
import type { BlockGrid } from '@game/grid';
import { HALF, HEIGHT, SEA_LEVEL, SIZE } from '@game/layout';
import type { WorldState } from '../worldState';
import { applyPackTiles, blockAtlas, faceTile, packWater, tileUv, waterTexture } from './blockTextures';
import { Clouds } from './clouds';
import { cornerBrightness, cornerOcclusion, lightmap, MAX_LIGHT, sideShade, SkyLight } from './lighting';
import type { LightChange } from './lighting';

// The world as meshes of 16×16-column chunks: only faces that touch something
// see-through are built (the three.js manual's voxel geometry), and a change
// rebuilds only the chunks whose blocks or light it touched. Each corner
// carries its brightness (lighting.ts: the face's shade, sky light averaged
// around it, ambient occlusion), and the sun casts shadows on top of that: a
// shadow map, as minecraft-renderer's sun shadows (github.com/zardoy/
// minecraft-web-client, MIT, Copyright (c) 2020 PrismarineJS) do it, taking sky
// light down to 60% where the sun does not reach, including faces turned away
// from it. Water is its own see-through mesh per chunk, its surface a little
// under the top of its cells, and the sea goes on past the world's edge as a
// plane. No other lighting: the pixel art's colours stay as painted.

const SKY_COLOR = 0x9fcfff;
const FOG = { near: 48, far: 140 } as const;
/** under water the view closes in, blue */
const WATER_FOG = { color: 0x1d3f8a, near: 0.5, far: 14 } as const;
const CHUNK = 16;
const CHUNKS = SIZE / CHUNK;
/** how long a frame may spend rebuilding chunks (ms); the rest wait for the next frame */
const BUILD_BUDGET_MS = 8;
/** a water cell's surface, when nothing but air is over it */
const WATER_TOP = 0.875;

/** Light by face direction: +x, -x, +y, -y, +z, -z (the avatars' boxes use it too). */
export const FACE_SHADE = [sideShade(1, 0, 0), sideShade(-1, 0, 0), sideShade(0, 1, 0), sideShade(0, -1, 0), sideShade(0, 0, 1), sideShade(0, 0, -1)] as const;

/** Toward the sun: high in the east, a little to the north, so trees and people throw their shadows
 * sideways and toward someone facing the big screen (which stands at -z). */
const SUN_DIRECTION = new THREE.Vector3(0.6, 1, -0.2).normalize();
/** What is left of the sky's light in the sun's shadow. */
const SHADOWED_SKY_LIGHT = 0.6;

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

interface Arrays { positions: number[]; normals: number[]; uvs: number[]; colors: number[]; indices: number[] }
const arrays = (): Arrays => ({ positions: [], normals: [], uvs: [], colors: [], indices: [] });

function toGeometry({ positions, normals, uvs, colors, indices }: Arrays): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** The faces of one chunk: its blocks, and its water apart. */
function chunkGeometry(grid: BlockGrid, sky: SkyLight, world: WorldState, cx: number, cz: number): { blocks: Arrays; water: Arrays } {
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
          waterFaces(grid, sky, water, x, y, z);
          continue;
        }
        const furnace = block === BLOCK.furnace ? world.furnaceAt(x, y, z) ?? undefined : undefined;
        FACES.forEach((face, faceIndex) => {
          const [dx, dy, dz] = face.dir;
          if (!faceShown(block, grid.get(x + dx, y + dy, z + dz))) return;
          const tile = tileUv(faceTile(block, faceIndex, furnace));
          const start = blocks.positions.length / 3;
          // the cell in front of the face, where its light comes from
          const fx = x + dx;
          const fy = y + dy;
          const fz = z + dz;
          const brightness: number[] = [];
          for (const [cx2, cy, cz2, cu, cv] of face.corners) {
            blocks.positions.push(x + cx2, y + cy, z + cz2);
            blocks.normals.push(dx, dy, dz);
            blocks.uvs.push(cu ? tile.u1 : tile.u0, cv ? tile.v1 : tile.v0);
            // the corner's two neighbours along the face, and the one diagonal between them
            const sx = dx === 0 ? cx2 * 2 - 1 : 0;
            const sy = dy === 0 ? cy * 2 - 1 : 0;
            const sz = dz === 0 ? cz2 * 2 - 1 : 0;
            const [a, b] = sx === 0 ? [[0, sy, 0], [0, 0, sz]] : sy === 0 ? [[sx, 0, 0], [0, 0, sz]] : [[sx, 0, 0], [0, sy, 0]];
            const cells = [[fx, fy, fz], [fx + a![0]!, fy + a![1]!, fz + a![2]!], [fx + b![0]!, fy + b![1]!, fz + b![2]!], [fx + sx, fy + sy, fz + sz]] as const;
            const [, side1, side2, corner] = cells.map(([bx, by, bz]) => grid.get(bx, by, bz));
            const occlusion = cornerOcclusion(occludes(side1!), occludes(side2!), occludes(corner!));
            // smooth light: the cells around the corner that light can be in
            let light = 0;
            let lit = 0;
            cells.forEach(([bx, by, bz], index) => {
              if (index > 0 && opaque(grid.get(bx, by, bz))) return;
              light += sky.at(bx, by, bz);
              lit++;
            });
            const value = cornerBrightness(face.shade, occlusion, lit ? light / lit : MAX_LIGHT);
            brightness.push(value);
            blocks.colors.push(value, value, value);
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

/** A water cell's faces toward air, leaves or glass: its top a little low when open to the sky, so the
 * surface sits under the shore's grass, each face tiled with the water texture in world units. */
function waterFaces(grid: BlockGrid, sky: SkyLight, out: Arrays, x: number, y: number, z: number): void {
  const top = grid.get(x, y + 1, z) === BLOCK.water ? 1 : WATER_TOP;
  FACES.forEach((face) => {
    const [dx, dy, dz] = face.dir;
    if (!faceShown(BLOCK.water, grid.get(x + dx, y + dy, z + dz))) return;
    const start = out.positions.length / 3;
    const value = face.shade * lightmap(sky.at(x + dx, y + dy, z + dz) / MAX_LIGHT);
    for (const [cx, cy, cz] of face.corners) {
      const py = y + (cy ? top : 0);
      out.positions.push(x + cx, py, z + cz);
      out.normals.push(dx, dy, dz);
      // the texture repeats once a block: tops by x and z, sides along the face and up
      out.uvs.push(dy !== 0 ? x + cx : dx !== 0 ? z + cz : x + cx, dy !== 0 ? z + cz : py);
      out.colors.push(value, value, value);
    }
    out.indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
  });
}

/** The blocks' material: the atlas, each corner's baked brightness, and the sun's shadow map. */
function blockMaterial(atlas: THREE.Texture): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    lights: true,
    fog: true,
    vertexColors: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.lights, THREE.UniformsLib.fog, { map: { value: null }, sunDirection: { value: new THREE.Vector3() } }]),
    defines: { SHADOWED_SKY_LIGHT: SHADOWED_SKY_LIGHT.toFixed(2) },
    vertexShader: /* glsl */ `
      #include <common>
      #include <fog_pars_vertex>
      #include <shadowmap_pars_vertex>
      varying vec2 vUv;
      varying vec3 vBrightness;
      varying vec3 vWorldNormal;
      void main() {
        vUv = uv;
        vBrightness = color;
        #include <beginnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        #include <project_vertex>
        #include <worldpos_vertex>
        #include <shadowmap_vertex>
        #include <fog_vertex>
        vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);
      }
    `,
    fragmentShader: /* glsl */ `
      #include <common>
      #include <packing>
      #include <fog_pars_fragment>
      #include <bsdfs>
      #include <lights_pars_begin>
      #include <shadowmap_pars_fragment>
      #include <shadowmask_pars_fragment>
      uniform sampler2D map;
      uniform vec3 sunDirection;
      varying vec2 vUv;
      varying vec3 vBrightness;
      varying vec3 vWorldNormal;
      void main() {
        vec4 texel = texture2D(map, vUv);
        // the holes in the leaves and the glass
        if (texel.a < 0.5) discard;
        // a face turned away from the sun is in its own shadow; one side-on to it, half
        float facing = smoothstep(-0.15, 0.15, dot(vWorldNormal, sunDirection));
        float sunlit = facing * getShadowMask();
        gl_FragColor = vec4(texel.rgb * vBrightness * mix(SHADOWED_SKY_LIGHT, 1.0, sunlit), texel.a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
  material.uniforms.map!.value = atlas;
  material.uniforms.sunDirection!.value = SUN_DIRECTION;
  return material;
}

/** The sun: only its shadow is used, over the whole world. */
function sunLight(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(110);
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
  /** advances what moves on its own: water, clouds; rebuilds chunks that changed, as time allows */
  update(dt: number): void;
  /** the sky light at a point (0..15), to light the people standing there */
  skyLightAt(x: number, y: number, z: number): number;
  /** blocks that changed: their light is worked out again and the chunks they touch rebuilt */
  blocksChanged(cells: readonly [number, number, number][]): void;
  /** a furnace lit or put out: its block is drawn again */
  furnaceChanged(x: number, z: number): void;
  /** the world arrived again (a reconnect): everything is built anew */
  reload(): void;
  /** whether the view is under water (the fog closes in) */
  setUnderwater(underwater: boolean): void;
  dispose(): void;
}

interface Chunk { blocks: THREE.Mesh | null; water: THREE.Mesh | null }

export function buildWorld(scene: THREE.Scene, state: WorldState): World {
  const skyFog = new THREE.Fog(SKY_COLOR, FOG.near, FOG.far);
  const waterFog = new THREE.Fog(WATER_FOG.color, WATER_FOG.near, WATER_FOG.far);
  const skyColor = new THREE.Color(SKY_COLOR);
  const waterColor = new THREE.Color(WATER_FOG.color);
  scene.background = skyColor;
  scene.fog = skyFog;

  const atlas = blockAtlas();
  void applyPackTiles(atlas);
  const material = blockMaterial(atlas);
  // the sun shines through the holes in the leaves too
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
  const sun = sunLight();
  scene.add(sun, sun.target);

  const water = waterTexture();
  let stepWater = (_dt: number) => {};
  void packWater(water).then((step) => { stepWater = step; });
  const waterMaterial = new THREE.MeshBasicMaterial({ map: water, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const sea = outerSea(new THREE.MeshBasicMaterial({ map: water, transparent: true, opacity: 0.84, depthWrite: false }));
  scene.add(sea);

  const clouds = new Clouds();
  scene.add(clouds.group);

  let sky: SkyLight | null = null;
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
    if (!grid || !sky) return;
    const cx = Math.floor(index / CHUNKS);
    const cz = index % CHUNKS;
    const chunk = chunks[index]!;
    disposeChunk(chunk);
    const built = chunkGeometry(grid, sky, state, cx, cz);
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

  function reload(): void {
    if (!state.grid) return;
    sky = new SkyLight(state.grid);
    for (let i = 0; i < chunks.length; i++) dirty.add(i);
  }
  reload();

  return {
    atlas,
    skyLightAt: (x, y, z) => (sky ? sky.at(Math.floor(x), Math.floor(y), Math.floor(z)) : MAX_LIGHT),
    blocksChanged(cells) {
      if (!sky) return;
      for (const [x, , z] of cells) {
        markBox(x, x, z, z);
        const change: LightChange | null = sky.update(x, z);
        if (change) markBox(change.minX, change.maxX, change.minZ, change.maxZ);
      }
    },
    furnaceChanged(x, z) {
      markBox(x, x, z, z);
    },
    reload,
    setUnderwater(underwater) {
      scene.fog = underwater ? waterFog : skyFog;
      scene.background = underwater ? waterColor : skyColor;
    },
    update(dt) {
      stepWater(dt);
      water.offset.x = (water.offset.x + dt * 0.04) % 1;
      water.offset.y = (water.offset.y + dt * 0.015) % 1;
      clouds.update(dt);
      const started = performance.now();
      for (const index of dirty) {
        dirty.delete(index);
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
      water.dispose();
      sea.geometry.dispose();
      (sea.material as THREE.Material).dispose();
      clouds.group.removeFromParent();
    },
  };
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCK, SEA_LEVEL, SIZE } from '../islandMap';
import type { IslandMap } from '../islandMap';
import { applyPackTiles, BLOCK_TILES, blockAtlas, packWater, tileUv, waterTexture } from './blockTextures';
import { cornerBrightness, cornerOcclusion, MAX_LIGHT, sideShade, SkyLight } from './lighting';

// The island as one mesh: only faces that touch air are built (the three.js
// manual's voxel geometry). Each corner carries its brightness (lighting.ts:
// the face's shade, sky light averaged around it, ambient occlusion), and the
// sun casts shadows on top of that: a shadow map, as minecraft-renderer's sun
// shadows (github.com/zardoy/minecraft-web-client, MIT, Copyright (c) 2020
// PrismarineJS) do it, taking sky light down to 60% where the sun does not
// reach, including faces turned away from it. No other lighting: the pixel
// art's colours stay as painted.

const SKY_COLOR = 0x9fcfff;
const FOG = { near: 40, far: 115 } as const;

/** Light by face direction: +x, -x, +y, -y, +z, -z (the avatars' boxes use it too). */
export const FACE_SHADE = [sideShade(1, 0, 0), sideShade(-1, 0, 0), sideShade(0, 1, 0), sideShade(0, -1, 0), sideShade(0, 0, 1), sideShade(0, 0, -1)] as const;

/** Toward the sun: high in the east, a little to the north, so trees and people throw their shadows
 * sideways and toward someone facing the big screen (which stands at -z). */
const SUN_DIRECTION = new THREE.Vector3(0.6, 1, -0.2).normalize();
/** What is left of the sky's light in the sun's shadow. */
const SHADOWED_SKY_LIGHT = 0.6;

// corner positions and their uv, after the three.js manual's voxel geometry
const FACES = [
  { dir: [1, 0, 0], shade: FACE_SHADE[0], side: 'side', corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [-1, 0, 0], shade: FACE_SHADE[1], side: 'side', corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [0, 1, 0], shade: FACE_SHADE[2], side: 'top', corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, -1, 0], shade: FACE_SHADE[3], side: 'bottom', corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 0, 1], shade: FACE_SHADE[4], side: 'side', corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
  { dir: [0, 0, -1], shade: FACE_SHADE[5], side: 'side', corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
] as const;

/** Blocks that cast ambient occlusion and stop smooth light: anything but air (leaves let light through). */
const occludes = (block: number) => block !== BLOCK.air;
const opaque = (block: number) => block !== BLOCK.air && block !== BLOCK.leaves;

function islandGeometry(island: IslandMap, sky: SkyLight): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  island.forEachBlock((x, y, z, block) => {
    if (block === BLOCK.air) return;
    const [top, side, bottom] = BLOCK_TILES[block];
    for (const face of FACES) {
      const [dx, dy, dz] = face.dir;
      // leaves have holes: what is behind them, other leaves included, is drawn too
      if (opaque(island.get(x + dx, y + dy, z + dz))) continue;
      const tile = tileUv(face.side === 'top' ? top : face.side === 'bottom' ? bottom : side);
      const start = positions.length / 3;
      // the cell in front of the face, where its light comes from
      const fx = x + dx;
      const fy = y + dy;
      const fz = z + dz;
      const brightness: number[] = [];
      for (const [cx, cy, cz, cu, cv] of face.corners) {
        positions.push(x + cx, y + cy, z + cz);
        normals.push(dx, dy, dz);
        uvs.push(cu ? tile.u1 : tile.u0, cv ? tile.v1 : tile.v0);
        // the corner's two neighbours along the face, and the one diagonal between them
        const sx = dx === 0 ? cx * 2 - 1 : 0;
        const sy = dy === 0 ? cy * 2 - 1 : 0;
        const sz = dz === 0 ? cz * 2 - 1 : 0;
        const [a, b] = sx === 0 ? [[0, sy, 0], [0, 0, sz]] : sy === 0 ? [[sx, 0, 0], [0, 0, sz]] : [[sx, 0, 0], [0, sy, 0]];
        const cells = [[fx, fy, fz], [fx + a![0]!, fy + a![1]!, fz + a![2]!], [fx + b![0]!, fy + b![1]!, fz + b![2]!], [fx + sx, fy + sy, fz + sz]] as const;
        const [, side1, side2, corner] = cells.map(([bx, by, bz]) => island.get(bx, by, bz));
        const occlusion = cornerOcclusion(occludes(side1!), occludes(side2!), occludes(corner!));
        // smooth light: the cells around the corner that light can be in
        let light = 0;
        let lit = 0;
        cells.forEach(([bx, by, bz], index) => {
          if (index > 0 && opaque(island.get(bx, by, bz))) return;
          light += sky.at(bx, by, bz);
          lit++;
        });
        const value = cornerBrightness(face.shade, occlusion, lit ? light / lit : MAX_LIGHT);
        brightness.push(value);
        colors.push(value, value, value);
      }
      // split the quad along its brighter diagonal, or the occlusion shows a seam across it
      if (brightness[0]! + brightness[3]! > brightness[1]! + brightness[2]!) {
        indices.push(start, start + 1, start + 3, start, start + 3, start + 2);
      } else {
        indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
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
        // the holes in the leaves
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

/** The sun: only its shadow is used, over the whole island. */
function sunLight(): THREE.DirectionalLight {
  const sun = new THREE.DirectionalLight(0xffffff, 0);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(60);
  sun.castShadow = true;
  const extent = SIZE / 2 + 6;
  Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 160 });
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2;
  return sun;
}

function cloudLayer(): THREE.Mesh {
  // a fixed pattern of flat blocky clouds, from a seeded scatter of cells
  const cell = 8;
  const span = 36;
  let state = 77;
  const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const boxes: THREE.BufferGeometry[] = [];
  for (let gx = 0; gx < span; gx++) {
    for (let gz = 0; gz < span; gz++) {
      if (rand() > 0.16) continue;
      const w = 1 + Math.floor(rand() * 3);
      const d = 1 + Math.floor(rand() * 2);
      const box = new THREE.BoxGeometry(w * cell, 2, d * cell);
      box.translate((gx - span / 2) * cell + (w * cell) / 2, 0, (gz - span / 2) * cell + (d * cell) / 2);
      boxes.push(box);
    }
  }
  const geometry = mergeGeometries(boxes) ?? new THREE.BufferGeometry();
  for (const box of boxes) box.dispose();
  const clouds = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.82, depthWrite: false }));
  clouds.position.y = 38;
  return clouds;
}

export interface World {
  /** advances what moves on its own: water, clouds */
  update(dt: number): void;
  /** the sky light at a point (0..15), to light the people standing there */
  skyLightAt(x: number, y: number, z: number): number;
}

export function buildWorld(scene: THREE.Scene, island: IslandMap): World {
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, FOG.near, FOG.far);

  const atlas = blockAtlas();
  const sky = new SkyLight(island);
  const blocks = new THREE.Mesh(islandGeometry(island, sky), blockMaterial(atlas));
  blocks.castShadow = true;
  blocks.receiveShadow = true;
  // the sun shines through the holes in the leaves too
  blocks.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: atlas, alphaTest: 0.5 });
  void applyPackTiles(atlas);
  scene.add(blocks);
  const sun = sunLight();
  scene.add(sun, sun.target);

  const water = waterTexture();
  let stepWater = (_dt: number) => {};
  void packWater(water).then((step) => { stepWater = step; });
  water.repeat.set(120, 120);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(240, 240),
    new THREE.MeshBasicMaterial({ map: water, transparent: true, opacity: 0.84, depthWrite: false }),
  );
  sea.rotation.x = -Math.PI / 2;
  // just under the shore's top, so the waterline sits on the beach
  sea.position.y = SEA_LEVEL - 0.12;
  sea.renderOrder = 1;
  scene.add(sea);

  const clouds = cloudLayer();
  scene.add(clouds);
  const cloudSpan = 36 * 8;

  return {
    skyLightAt: (x, y, z) => sky.at(Math.floor(x), Math.floor(y), Math.floor(z)),
    update(dt) {
      stepWater(dt);
      water.offset.x = (water.offset.x + dt * 0.04) % 1;
      water.offset.y = (water.offset.y + dt * 0.015) % 1;
      clouds.position.x = ((clouds.position.x + dt * 0.8 + cloudSpan / 2) % cloudSpan) - cloudSpan / 2;
    },
  };
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCK, SEA_LEVEL } from '../islandMap';
import type { IslandMap } from '../islandMap';
import { BLOCK_TILES, blockAtlas, tileUv, waterTexture } from './blockTextures';

// The island as one mesh: only faces that touch air are built (the three.js
// manual's voxel geometry), each shaded by the way it faces, the way blocky
// games light their worlds without lights: tops full, sides dimmer, bottoms
// darkest. Unlit materials keep the pixel art's colours exactly as painted.

export const SKY_COLOR = 0x9fcfff;
export const FOG = { near: 40, far: 115 } as const;

/** Light by face direction: +x, -x, +y, -y, +z, -z. */
export const FACE_SHADE = [0.62, 0.62, 1, 0.5, 0.8, 0.8] as const;

// corner positions and their uv, after the three.js manual's voxel geometry
const FACES = [
  { dir: [1, 0, 0], shade: FACE_SHADE[0], side: 'side', corners: [[1, 1, 1, 0, 1], [1, 0, 1, 0, 0], [1, 1, 0, 1, 1], [1, 0, 0, 1, 0]] },
  { dir: [-1, 0, 0], shade: FACE_SHADE[1], side: 'side', corners: [[0, 1, 0, 0, 1], [0, 0, 0, 0, 0], [0, 1, 1, 1, 1], [0, 0, 1, 1, 0]] },
  { dir: [0, 1, 0], shade: FACE_SHADE[2], side: 'top', corners: [[0, 1, 1, 1, 1], [1, 1, 1, 0, 1], [0, 1, 0, 1, 0], [1, 1, 0, 0, 0]] },
  { dir: [0, -1, 0], shade: FACE_SHADE[3], side: 'bottom', corners: [[1, 0, 1, 1, 0], [0, 0, 1, 0, 0], [1, 0, 0, 1, 1], [0, 0, 0, 0, 1]] },
  { dir: [0, 0, 1], shade: FACE_SHADE[4], side: 'side', corners: [[0, 0, 1, 0, 0], [1, 0, 1, 1, 0], [0, 1, 1, 0, 1], [1, 1, 1, 1, 1]] },
  { dir: [0, 0, -1], shade: FACE_SHADE[5], side: 'side', corners: [[1, 0, 0, 0, 0], [0, 0, 0, 1, 0], [1, 1, 0, 0, 1], [0, 1, 0, 1, 1]] },
] as const;

function islandGeometry(island: IslandMap): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  island.forEachBlock((x, y, z, block) => {
    if (block === BLOCK.air) return;
    const [top, side, bottom] = BLOCK_TILES[block];
    for (const face of FACES) {
      const [dx, dy, dz] = face.dir;
      if (island.get(x + dx, y + dy, z + dz) !== BLOCK.air) continue;
      const tile = tileUv(face.side === 'top' ? top : face.side === 'bottom' ? bottom : side);
      const start = positions.length / 3;
      for (const [cx, cy, cz, cu, cv] of face.corners) {
        positions.push(x + cx, y + cy, z + cz);
        uvs.push(cu ? tile.u1 : tile.u0, cv ? tile.v1 : tile.v0);
        colors.push(face.shade, face.shade, face.shade);
      }
      indices.push(start, start + 1, start + 2, start + 2, start + 1, start + 3);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
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
}

export function buildWorld(scene: THREE.Scene, island: IslandMap): World {
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, FOG.near, FOG.far);

  const atlas = blockAtlas();
  scene.add(new THREE.Mesh(islandGeometry(island), new THREE.MeshBasicMaterial({ map: atlas, vertexColors: true })));

  const water = waterTexture();
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
    update(dt) {
      water.offset.x = (water.offset.x + dt * 0.04) % 1;
      water.offset.y = (water.offset.y + dt * 0.015) % 1;
      clouds.position.x = ((clouds.position.x + dt * 0.8 + cloudSpan / 2) % cloudSpan) - cloudSpan / 2;
    },
  };
}

import * as THREE from 'three';
import { SCREEN, WORLD_RADIUS } from '../playgroundWorld';
import { NO_OUTLINE_LAYER } from './outlineRenderer';
import { toon } from './toon';

// The first map: a clearing in a pine wood, a stone plaza in the middle, the
// big screen at its north end with benches facing it, lamp posts around the
// plaza. Everything is built from primitives (no files to load) and the many
// repeated pieces are instanced, so the whole world is a few dozen draw calls.

export type Collider =
  | { kind: 'circle'; x: number; z: number; r: number }
  | { kind: 'box'; minX: number; maxX: number; minZ: number; maxZ: number };

export const SKY_COLOR = 0xa9d6ee;
const SKY_TOP = 0x5ea8e6;
export const FOG = { near: 38, far: 90 } as const;
const PLAZA_RADIUS = 9;

/** A seeded random source, so everyone's world has its trees in the same places. */
function random(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}


export function buildWorld(scene: THREE.Scene): Collider[] {
  const colliders: Collider[] = [];
  const rand = random(20261123);

  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, FOG.near, FOG.far);
  scene.add(buildSky());

  // toon bands come from the sun alone; the hemisphere evenly lifts the shadow side
  scene.add(new THREE.HemisphereLight(0xe4f2ff, 0x6f8f52, 1.1));
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.9);
  sun.position.set(20, 32, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 100 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // ground: a wide disc whose edge the fog hides, with a little colour noise
  const groundGeometry = new THREE.CircleGeometry(110, 96, 0, Math.PI * 2);
  const colors: number[] = [];
  const grass = new THREE.Color();
  for (let i = 0; i < groundGeometry.attributes.position!.count; i++) {
    grass.setHSL(0.27 + rand() * 0.03, 0.42, 0.42 + rand() * 0.06);
    colors.push(grass.r, grass.g, grass.b);
  }
  groundGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(groundGeometry, toon(0xffffff, { vertexColors: true }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const plaza = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA_RADIUS, PLAZA_RADIUS + 0.15, 0.04, 48), toon(0xcbbd9f));
  plaza.position.y = 0.02;
  plaza.receiveShadow = true;
  scene.add(plaza);
  const path = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.04, 8), toon(0xbfb193));
  path.position.set(0, 0.02, -PLAZA_RADIUS - 3);
  path.receiveShadow = true;
  scene.add(path);

  buildScreenStand(scene, colliders);
  buildBenches(scene, colliders);
  buildLamps(scene, colliders);
  buildTrees(scene, colliders, rand);
  buildRocks(scene, colliders, rand);
  return colliders;
}

/** A dome fading from the horizon's haze to a deeper blue overhead. */
function buildSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(150, 32, 16);
  const position = geometry.attributes.position!;
  const horizon = new THREE.Color(SKY_COLOR);
  const top = new THREE.Color(SKY_TOP);
  const colors: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const height = Math.max(position.getY(i) / 150, 0);
    c.copy(horizon).lerp(top, Math.pow(height, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.layers.set(NO_OUTLINE_LAYER);
  sky.renderOrder = -1;
  return sky;
}

function buildScreenStand(scene: THREE.Scene, colliders: Collider[]): void {
  const dark = toon(0x2b2d33);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(SCREEN.width + 0.7, SCREEN.height + 0.7, 0.4), dark);
  frame.position.set(SCREEN.x, SCREEN.y, SCREEN.z - 0.2);
  frame.castShadow = true;
  scene.add(frame);
  const bottom = SCREEN.y - SCREEN.height / 2 - 0.35;
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, bottom, 0.5), dark);
    leg.position.set(SCREEN.x + side * (SCREEN.width / 2 - 1.5), bottom / 2, SCREEN.z - 0.2);
    leg.castShadow = true;
    scene.add(leg);
  }
  const stage = new THREE.Mesh(new THREE.BoxGeometry(SCREEN.width + 3, 0.5, 3), toon(0x8a6a4a));
  stage.position.set(SCREEN.x, 0.25, SCREEN.z - 0.4);
  stage.castShadow = true;
  stage.receiveShadow = true;
  scene.add(stage);
  colliders.push({ kind: 'box', minX: SCREEN.x - (SCREEN.width + 3) / 2, maxX: SCREEN.x + (SCREEN.width + 3) / 2, minZ: SCREEN.z - 1.9, maxZ: SCREEN.z + 1.1 });
}

function buildBenches(scene: THREE.Scene, colliders: Collider[]): void {
  const wood = toon(0x9c6b3f);
  const seats: [number, number][] = [[-3, -8.5], [3, -8.5], [-3, -5.5], [3, -5.5]];
  const seat = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 0.12, 0.7), wood, seats.length);
  const back = new THREE.InstancedMesh(new THREE.BoxGeometry(3.4, 0.6, 0.1), wood, seats.length);
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.45, 0.6), wood, seats.length * 2);
  const m = new THREE.Matrix4();
  seats.forEach(([x, z], i) => {
    seat.setMatrixAt(i, m.makeTranslation(x, 0.45, z));
    back.setMatrixAt(i, m.makeTranslation(x, 0.8, z + 0.32));
    legs.setMatrixAt(i * 2, m.makeTranslation(x - 1.4, 0.22, z));
    legs.setMatrixAt(i * 2 + 1, m.makeTranslation(x + 1.4, 0.22, z));
    colliders.push({ kind: 'box', minX: x - 1.75, maxX: x + 1.75, minZ: z - 0.4, maxZ: z + 0.42 });
  });
  for (const mesh of [seat, back, legs]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function buildLamps(scene: THREE.Scene, colliders: Collider[]): void {
  const count = 6;
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.12, 3.2, 8), toon(0x2f3136), count);
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 12, 8), toon(0xfff1c7, { emissive: 0xffd98a, emissiveIntensity: 0.8 }), count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    // leave the screen's side of the ring open
    const angle = Math.PI / 2 + ((i - (count - 1) / 2) * (Math.PI * 1.25)) / (count - 1);
    const x = Math.cos(angle) * (PLAZA_RADIUS + 0.6);
    const z = Math.sin(angle) * (PLAZA_RADIUS + 0.6);
    posts.setMatrixAt(i, m.makeTranslation(x, 1.6, z));
    bulbs.setMatrixAt(i, m.makeTranslation(x, 3.3, z));
    colliders.push({ kind: 'circle', x, z, r: 0.2 });
  }
  posts.castShadow = true;
  scene.add(posts, bulbs);
}

function buildTrees(scene: THREE.Scene, colliders: Collider[], rand: () => number): void {
  const spots: { x: number; z: number; s: number }[] = [];
  // scattered inside the walkable area, kept off the plaza and the screen's lawn
  while (spots.length < 34) {
    const angle = rand() * Math.PI * 2;
    const r = 14 + rand() * (WORLD_RADIUS - 15);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    if (z < -10 && Math.abs(x) < 12) continue;
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 3.2)) continue;
    spots.push({ x, z, s: 0.8 + rand() * 0.6 });
  }
  const inside = spots.length;
  // and a dense wood around the edge, so the world ends in trees rather than a wall
  for (let i = 0; i < 120; i++) {
    const angle = (i / 120) * Math.PI * 2 + rand() * 0.05;
    const r = WORLD_RADIUS + 1.5 + rand() * 14;
    spots.push({ x: Math.cos(angle) * r, z: Math.sin(angle) * r, s: 1 + rand() * 0.8 });
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.18, 0.28, 1.4, 6), toon(0x6b4a2f), spots.length);
  const lower = new THREE.InstancedMesh(new THREE.ConeGeometry(1.3, 2.4, 7), toon(0x3f7a3a), spots.length);
  const upper = new THREE.InstancedMesh(new THREE.ConeGeometry(0.9, 1.8, 7), toon(0x4d8c42), spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  spots.forEach(({ x, z, s }, i) => {
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    const scale = new THREE.Vector3(s, s, s);
    trunks.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.7 * s, z), q, scale));
    lower.setMatrixAt(i, m.compose(new THREE.Vector3(x, 2.4 * s, z), q, scale));
    upper.setMatrixAt(i, m.compose(new THREE.Vector3(x, 3.6 * s, z), q, scale));
    if (i < inside) colliders.push({ kind: 'circle', x, z, r: 0.35 * s });
  });
  for (const mesh of [trunks, lower, upper]) {
    mesh.castShadow = true;
    scene.add(mesh);
  }
}

function buildRocks(scene: THREE.Scene, colliders: Collider[], rand: () => number): void {
  const count = 16;
  const rocks = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.6, 0), toon(0x8d9097), count);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < count; i++) {
    const angle = rand() * Math.PI * 2;
    const r = 11 + rand() * (WORLD_RADIUS - 12);
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    const s = 0.5 + rand() * 1.1;
    q.setFromEuler(new THREE.Euler(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI));
    rocks.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.15 * s, z), q, new THREE.Vector3(s, s * 0.7, s)));
    colliders.push({ kind: 'circle', x, z, r: 0.55 * s });
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);
}

const PLAYER_RADIUS = 0.35;

/** Pushes a walker at (x, z) out of anything solid and back inside the world. */
export function resolveCollisions(position: THREE.Vector3, colliders: Collider[]): void {
  for (const c of colliders) {
    if (c.kind === 'circle') {
      const dx = position.x - c.x;
      const dz = position.z - c.z;
      const min = c.r + PLAYER_RADIUS;
      const d = Math.hypot(dx, dz);
      if (d < min && d > 1e-6) {
        position.x = c.x + (dx / d) * min;
        position.z = c.z + (dz / d) * min;
      }
    } else {
      const nx = Math.min(Math.max(position.x, c.minX), c.maxX);
      const nz = Math.min(Math.max(position.z, c.minZ), c.maxZ);
      const dx = position.x - nx;
      const dz = position.z - nz;
      const d = Math.hypot(dx, dz);
      if (d >= PLAYER_RADIUS) continue;
      if (d > 1e-6) {
        position.x = nx + (dx / d) * PLAYER_RADIUS;
        position.z = nz + (dz / d) * PLAYER_RADIUS;
      } else {
        // inside the box: leave by the nearest side
        const exits = [position.x - c.minX, c.maxX - position.x, position.z - c.minZ, c.maxZ - position.z];
        const nearest = exits.indexOf(Math.min(...exits));
        if (nearest === 0) position.x = c.minX - PLAYER_RADIUS;
        else if (nearest === 1) position.x = c.maxX + PLAYER_RADIUS;
        else if (nearest === 2) position.z = c.minZ - PLAYER_RADIUS;
        else position.z = c.maxZ + PLAYER_RADIUS;
      }
    }
  }
  const r = Math.hypot(position.x, position.z);
  if (r > WORLD_RADIUS) {
    position.x = (position.x / r) * WORLD_RADIUS;
    position.z = (position.z / r) * WORLD_RADIUS;
  }
}

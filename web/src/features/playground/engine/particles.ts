import * as THREE from 'three';
import flameUrl from '../assets/kenuis-default/particle/flame.png?url';
import critUrl from '../assets/pixel-perfection/particle/critical_hit.png?url';
import damageUrl from '../assets/pixel-perfection/particle/damage.png?url';
import generic0Url from '../assets/pixel-perfection/particle/generic_0.png?url';
import generic1Url from '../assets/pixel-perfection/particle/generic_1.png?url';
import generic2Url from '../assets/pixel-perfection/particle/generic_2.png?url';
import generic3Url from '../assets/pixel-perfection/particle/generic_3.png?url';
import generic4Url from '../assets/pixel-perfection/particle/generic_4.png?url';
import generic5Url from '../assets/pixel-perfection/particle/generic_5.png?url';
import generic6Url from '../assets/pixel-perfection/particle/generic_6.png?url';
import generic7Url from '../assets/pixel-perfection/particle/generic_7.png?url';
import type { Terrain } from './playerPhysics';

// The block game's particles, each a small square facing the camera, stepped
// at the game's 20 ticks a second with its own rules (written from how the
// game behaves; the textures are Pixel Perfection's, the flame Kenui's Default's):
// - crit: the stars of a critical hit, thrown out of the target's middle for 3
//   ticks; they slow fast, sink a little and warm from grey to yellow;
// - damage: the dark hearts that rise from whoever was hurt;
// - poof: the grey puffs left where a dead player vanishes, shrinking as they rise;
// - flame and smoke, from a torch's tip (blockAnimation.ts): the flame hangs
//   there at full brightness, shrinking; the dark smoke drifts up;
// - crumbs of what someone eats: a random 4-pixel square of the food's picture
//   each, thrown out of the mouth and falling.

const MAX_PARTICLES = 300;
/** a particle's size 1 is this wide, in blocks */
const UNIT_SIZE = 0.2;
const CRIT_EMITTER_TICKS = 3;
const CRIT_TRIES_PER_TICK = 16;
const PLAYER_WIDTH = 0.6;
const PLAYER_HEIGHT = 1.8;

type Kind = 'crit' | 'damage' | 'poof' | 'flame' | 'smoke' | 'crumb';

interface Particle {
  kind: Kind;
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  x: number; y: number; z: number;
  px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  age: number;
  maxAge: number;
  size: number;
  r: number; g: number; b: number;
  onGround: boolean;
}

interface Emitter { x: number; y: number; z: number; ticks: number }

const rand = Math.random;
function gaussian(): number {
  const u = 1 - rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function loadTexture(loader: THREE.TextureLoader, url: string): THREE.Texture {
  const texture = loader.load(url);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Particles {
  readonly group = new THREE.Group();
  private readonly particles: Particle[] = [];
  private readonly emitters: Emitter[] = [];
  private readonly terrain: Pick<Terrain, 'isSolid'>;
  private readonly lightAt: (x: number, y: number, z: number, out: THREE.Color) => THREE.Color;
  private readonly light = new THREE.Color();
  private readonly crit: THREE.Texture;
  private readonly damage: THREE.Texture;
  private readonly flame: THREE.Texture;
  /** the puff's frames, from the largest (smoke's too) */
  private readonly poof: THREE.Texture[];
  private readonly loader = new THREE.TextureLoader();
  /** item pictures crumbs are cut from, by url */
  private readonly pictures = new Map<string, THREE.Texture>();

  constructor(terrain: Pick<Terrain, 'isSolid'>, lightAt: (x: number, y: number, z: number, out: THREE.Color) => THREE.Color) {
    this.terrain = terrain;
    this.lightAt = lightAt;
    const loader = this.loader;
    this.crit = loadTexture(loader, critUrl);
    this.damage = loadTexture(loader, damageUrl);
    this.flame = loadTexture(loader, flameUrl);
    this.poof = [generic7Url, generic6Url, generic5Url, generic4Url, generic3Url, generic2Url, generic1Url, generic0Url].map((url) => loadTexture(loader, url));
  }

  /** A critical hit on the player standing at (x, y, z): stars burst from its middle for 3 ticks. */
  critical(x: number, y: number, z: number): void {
    this.emitters.push({ x, y, z, ticks: 0 });
  }

  /** Dark hearts rising out of a player that was hurt by `damage`. */
  damageIndicator(x: number, y: number, z: number, damage: number): void {
    // the game spawns damage / 2 of them, none for a bare hand: at least one shows every hit
    const count = Math.max(1, Math.floor(damage * 0.5));
    for (let i = 0; i < count; i++) {
      this.spawnCrit('damage', x + gaussian() * 0.1, y + PLAYER_HEIGHT * 0.5, z + gaussian() * 0.1, gaussian() * 0.2, gaussian() * 0.2 + 1, gaussian() * 0.2);
    }
  }

  /** The puffs where a dead player vanishes. */
  vanish(x: number, y: number, z: number): void {
    for (let i = 0; i < 20; i++) {
      this.spawnPoof(
        x + rand() * PLAYER_WIDTH * 2 - PLAYER_WIDTH, y + rand() * PLAYER_HEIGHT, z + rand() * PLAYER_WIDTH * 2 - PLAYER_WIDTH,
        gaussian() * 0.02, gaussian() * 0.02, gaussian() * 0.02,
      );
    }
  }

  /** A torch's flame and smoke, at (x, y, z) (its tip). */
  torch(x: number, y: number, z: number): void {
    const smoke = this.add('smoke', this.poof[0]!, x, y, z, 0, 0, 0);
    if (smoke) {
      smoke.vx *= 0.1;
      smoke.vy *= 0.1;
      smoke.vz *= 0.1;
      const grey = rand() * 0.3;
      smoke.r = grey;
      smoke.g = grey;
      smoke.b = grey;
      smoke.size *= 0.75;
      smoke.maxAge = Math.floor(8 / (rand() * 0.8 + 0.2));
    }
    const flame = this.add('flame', this.flame, x, y, z, 0, 0, 0);
    if (flame) {
      flame.vx *= 0.01;
      flame.vy *= 0.01;
      flame.vz *= 0.01;
      flame.maxAge = Math.floor(8 / (rand() * 0.8 + 0.2)) + 4;
    }
  }

  /** Crumbs of a picture (`url`, an item's), thrown out of a mouth whose eyes are at (x, y, z) and look along
   * `yaw`/`pitch` (radians; yaw 0 looks toward -z, pitch up is positive): the game's, 0.6 in front, a little
   * below, flying forward and up before they fall. */
  crumbs(url: string, x: number, y: number, z: number, yaw: number, pitch: number, count: number): void {
    let picture = this.pictures.get(url);
    if (!picture) {
      picture = loadTexture(this.loader, url);
      this.pictures.set(url, picture);
    }
    const look = new THREE.Euler(pitch, yaw, 0, 'YXZ');
    const offset = new THREE.Vector3();
    const speed = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      offset.set((rand() - 0.5) * 0.3, -rand() * 0.6 - 0.3, -0.6).applyEuler(look);
      speed.set((rand() - 0.5) * 0.1, rand() * 0.1 + 0.1, 0).applyEuler(look);
      const texture = picture.clone();
      texture.repeat.set(0.25, 0.25);
      texture.offset.set((rand() * 12) / 16, (rand() * 12) / 16);
      const crumb = this.add('crumb', texture, x + offset.x, y + offset.y, z + offset.z, 0, 0, 0);
      if (!crumb) {
        texture.dispose();
        return;
      }
      crumb.vx = crumb.vx * 0.1 + speed.x;
      crumb.vy = crumb.vy * 0.1 + speed.y + 0.05;
      crumb.vz = crumb.vz * 0.1 + speed.z;
      crumb.size /= 2;
    }
  }

  /** A particle's start shared by every kind: a random kick around the given speed, and its size and life. */
  private add(kind: Kind, texture: THREE.Texture, x: number, y: number, z: number, vx: number, vy: number, vz: number): Particle | null {
    if (this.particles.length >= MAX_PARTICLES) return null;
    let mx = vx + (rand() * 2 - 1) * 0.4;
    let my = vy + (rand() * 2 - 1) * 0.4;
    let mz = vz + (rand() * 2 - 1) * 0.4;
    const speed = (rand() + rand() + 1) * 0.15;
    const length = Math.hypot(mx, my, mz) || 1;
    mx = (mx / length) * speed * 0.4;
    my = (my / length) * speed * 0.4 + 0.1;
    mz = (mz / length) * speed * 0.4;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.1, depthWrite: false });
    const sprite = new THREE.Sprite(material);
    this.group.add(sprite);
    const particle: Particle = {
      kind, sprite, material, x, y, z, px: x, py: y, pz: z, vx: mx, vy: my, vz: mz,
      age: 0, maxAge: Math.floor(4 / (rand() * 0.9 + 0.1)), size: (rand() * 0.5 + 0.5) * 2, r: 1, g: 1, b: 1, onGround: false,
    };
    this.particles.push(particle);
    return particle;
  }

  private spawnCrit(kind: 'crit' | 'damage', x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const particle = this.add(kind, kind === 'crit' ? this.crit : this.damage, x, y, z, 0, 0, 0);
    if (!particle) return;
    particle.vx = particle.vx * 0.1 + vx * 0.4;
    particle.vy = particle.vy * 0.1 + vy * 0.4;
    particle.vz = particle.vz * 0.1 + vz * 0.4;
    const grey = rand() * 0.3 + 0.6;
    particle.r = grey;
    particle.g = grey;
    particle.b = grey;
    particle.size *= 0.75;
    particle.maxAge = kind === 'damage' ? 20 : Math.max(1, Math.floor(6 / (rand() * 0.8 + 0.6)));
  }

  private spawnPoof(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    const particle = this.add('poof', this.poof[0]!, x, y, z, vx, vy, vz);
    if (!particle) return;
    particle.vx = vx + (rand() * 2 - 1) * 0.05;
    particle.vy = vy + (rand() * 2 - 1) * 0.05;
    particle.vz = vz + (rand() * 2 - 1) * 0.05;
    const grey = rand() * 0.3 + 0.7;
    particle.r = grey;
    particle.g = grey;
    particle.b = grey;
    particle.size = rand() * rand() * 6 + 1;
    particle.maxAge = Math.floor(16 / (rand() * 0.8 + 0.2)) + 2;
  }

  /** One of the game's ticks. */
  tick(): void {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const emitter = this.emitters[i]!;
      for (let n = 0; n < CRIT_TRIES_PER_TICK; n++) {
        const dx = rand() * 2 - 1;
        const dy = rand() * 2 - 1;
        const dz = rand() * 2 - 1;
        if (dx * dx + dy * dy + dz * dz > 1) continue;
        this.spawnCrit('crit',
          emitter.x + dx * PLAYER_WIDTH / 4, emitter.y + PLAYER_HEIGHT / 2 + dy * PLAYER_HEIGHT / 4, emitter.z + dz * PLAYER_WIDTH / 4,
          dx, dy + 0.2, dz);
      }
      if (++emitter.ticks >= CRIT_EMITTER_TICKS) this.emitters.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
      if (p.age++ >= p.maxAge) {
        this.remove(i);
        continue;
      }
      if (p.kind === 'poof' || p.kind === 'smoke') {
        p.vy += 0.004;
        this.move(p);
        const drag = p.kind === 'smoke' ? 0.96 : 0.9;
        p.vx *= drag;
        p.vy *= drag;
        p.vz *= drag;
      } else if (p.kind === 'crumb') {
        p.vy -= 0.04;
        this.move(p);
        p.vx *= 0.98;
        p.vy *= 0.98;
        p.vz *= 0.98;
      } else if (p.kind === 'flame') {
        // nothing stops a flame: it hangs where it was lit, slowing
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.vz *= 0.96;
      } else {
        this.move(p);
        if (p.kind === 'crit') {
          p.g *= 0.96;
          p.b *= 0.9;
        }
        p.vx *= 0.7;
        p.vy *= 0.7;
        p.vz *= 0.7;
        p.vy -= 0.02;
      }
      if (p.onGround) {
        p.vx *= 0.7;
        p.vz *= 0.7;
      }
    }
  }

  /** Moves a particle, stopping it on the block below or above. */
  private move(p: Particle): void {
    const cell = (n: number) => Math.floor(n);
    if (this.terrain.isSolid(cell(p.x), cell(p.y + p.vy), cell(p.z))) {
      p.onGround = p.vy < 0;
      p.vy = 0;
    } else {
      p.onGround = false;
      p.y += p.vy;
    }
    if (!this.terrain.isSolid(cell(p.x + p.vx), cell(p.y), cell(p.z))) p.x += p.vx;
    else p.vx = 0;
    if (!this.terrain.isSolid(cell(p.x), cell(p.y), cell(p.z + p.vz))) p.z += p.vz;
    else p.vz = 0;
  }

  /** Places every particle between its last two ticks (`partial` 0..1). */
  update(partial: number): void {
    for (const p of this.particles) {
      const x = p.px + (p.x - p.px) * partial;
      const y = p.py + (p.y - p.py) * partial;
      const z = p.pz + (p.z - p.pz) * partial;
      p.sprite.position.set(x, y, z);
      let size = p.size;
      const life = (p.age + partial) / p.maxAge;
      if (p.kind === 'flame') size *= 1 - life * life * 0.5;
      else if (p.kind !== 'poof') size *= Math.min(1, Math.max(0, life * 32));
      if (p.kind === 'poof' || p.kind === 'smoke') p.material.map = this.poof[Math.min(this.poof.length - 1, Math.floor((p.age * this.poof.length) / p.maxAge))]!;
      p.sprite.scale.setScalar(size * UNIT_SIZE);
      // a flame gives its own light
      const light = p.kind === 'flame' ? this.light.setScalar(1) : this.lightAt(x, y, z, this.light);
      p.material.color.setRGB(p.r * light.r, p.g * light.g, p.b * light.b);
    }
  }

  private remove(index: number): void {
    const [p] = this.particles.splice(index, 1);
    if (!p) return;
    p.sprite.removeFromParent();
    // a crumb's square is its own copy of the picture
    if (p.kind === 'crumb') p.material.map?.dispose();
    p.material.dispose();
  }

  dispose(): void {
    while (this.particles.length) this.remove(this.particles.length - 1);
    this.emitters.length = 0;
    this.crit.dispose();
    this.damage.dispose();
    this.flame.dispose();
    for (const texture of this.poof) texture.dispose();
    for (const texture of this.pictures.values()) texture.dispose();
    this.pictures.clear();
    this.group.removeFromParent();
  }
}

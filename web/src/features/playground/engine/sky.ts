import * as THREE from 'three';
import { celestialAngle, daylight, moonPhase } from '@game/dayTime';
import moonUrl from '../assets/kenuis-default/environment/moon_phases.png?url';
import sunUrl from '../assets/kenuis-default/environment/sun.png?url';

// The sky, the block game's way: its colour overhead fading into the fog's at
// the horizon, an orange glow on the side of a rising or setting sun, the stars
// coming out as it gets dark and turning with the night, and the sun and the
// phase of the moon (Kenui's Default's pictures) crossing it from east (+x) to
// west, added to the sky behind them. The colours, the glow, the stars and the
// sun's and moon's path follow the game as minecraft-renderer reproduces it
// (src/three/skyboxRenderer.ts and modules/sunMoon.ts in
// github.com/zardoy/minecraft-renderer, MIT, Copyright (c) 2020 PrismarineJS)
// and the game's own star field (1500 stars, a fixed seed).

/** The game's sky colour where it is warm and green (plains: temperature 0.8), by full day (sRGB). */
const DAY_SKY = [0.4733, 0.6564, 1] as const;
/** The fog's colour by full day (sRGB); it darkens a little less than the sky toward the night. */
const DAY_FOG = [0.7529, 0.8471, 1] as const;
/** how far the fog takes on the sky's colour at the view distance the island needs */
const FOG_TOWARD_SKY = 0.19;

/** The sky's colour and the fog's at a clock. */
export function skyColors(clock: number): { sky: THREE.Color; fog: THREE.Color } {
  const light = daylight(clock);
  const sky = DAY_SKY.map((channel) => channel * light);
  const fog = [light * 0.94 + 0.06, light * 0.94 + 0.06, light * 0.91 + 0.09].map((scale, i) => {
    const own = DAY_FOG[i]! * scale;
    return own + (sky[i]! - own) * FOG_TOWARD_SKY;
  });
  // the game mixes them as stored (sRGB); three.js works in linear
  return {
    sky: new THREE.Color().setRGB(sky[0]!, sky[1]!, sky[2]!, THREE.SRGBColorSpace),
    fog: new THREE.Color().setRGB(fog[0]!, fog[1]!, fog[2]!, THREE.SRGBColorSpace),
  };
}

/** Toward the sun at a clock (unit length): up at noon, east at sunrise, west at sunset, leaning a
 * little south so noon's shadows are not straight down. The moon is the other way. */
export function sunDirection(clock: number, out = new THREE.Vector3()): THREE.Vector3 {
  const angle = celestialAngle(clock) * Math.PI * 2;
  return out.set(-Math.sin(angle), Math.cos(angle), 0.25).normalize();
}

/** The glow at sunrise and sunset, the game's: its colour (sRGB) and strength, or null by day and night. */
export function sunriseGlow(clock: number): { color: [number, number, number]; strength: number } | null {
  const height = Math.cos(celestialAngle(clock) * Math.PI * 2);
  if (height < -0.4 || height > 0.4) return null;
  const g = (height / 0.4) * 0.5 + 0.5;
  const strength = (1 - (1 - Math.sin(g * Math.PI)) * 0.99) ** 2;
  return { color: [g * 0.3 + 0.7, g * g * 0.7 + 0.2, 0.2], strength };
}

/** How bright the stars are, 0 by day to 0.5 at the darkest of the night. */
export function starBrightness(clock: number): number {
  const f = Math.min(1, Math.max(0, 1 - (Math.cos(celestialAngle(clock) * Math.PI * 2) * 2 + 0.25)));
  return f * f * 0.5;
}

function domeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.BackSide,
    uniforms: {
      skyColor: { value: new THREE.Color() },
      fogColor: { value: new THREE.Color() },
      glowColor: { value: new THREE.Color() },
      glowStrength: { value: 0 },
      /** which way along x the sun is, for the glow (+1 east, -1 west) */
      glowSide: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        // only the view's turn, never where the eye is: the sky is infinitely far, so it never moves
        // with the player (walking, jumping, the view's bob)
        gl_Position = projectionMatrix * vec4(mat3(modelViewMatrix) * position, 1.0);
        // always at the far end of the view
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 skyColor;
      uniform vec3 fogColor;
      uniform vec3 glowColor;
      uniform float glowStrength;
      uniform float glowSide;
      varying vec3 vDirection;
      void main() {
        vec3 d = normalize(vDirection);
        // overhead the sky's own colour, toward the horizon (and under it) the fog's
        vec3 color = mix(fogColor, skyColor, smoothstep(0.0, 0.45, d.y));
        // the glow spreads along the horizon from where the sun is, and up a little
        float toward = max(0.0, d.x * glowSide);
        float glow = glowStrength * pow(toward, 1.5) * (1.0 - smoothstep(0.0, 0.55, abs(d.y - 0.05)));
        color = mix(color, glowColor, glow);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function loadPixelTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function bodyMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  // the game adds the sun and the moon to the sky behind them
  return new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
}

/** the sun's, moon's and stars' distance from the eye, and the bodies' sizes, the game's */
const BODY_DISTANCE = 100;
const SUN_SIZE = 60;
const MOON_SIZE = 40;
const STAR_COUNT = 1500;
const STAR_SEED = 10842;

/** The game's stars: small squares at random on a sphere round the eye, each turned its own way. */
function starGeometry(): THREE.BufferGeometry {
  let seed = STAR_SEED;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions: number[] = [];
  const indices: number[] = [];
  const direction = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const corner = new THREE.Vector3();
  for (let made = 0; made < STAR_COUNT;) {
    direction.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
    const length = direction.length();
    if (length < 0.01 || length > 1) continue;
    direction.divideScalar(length);
    const size = 0.15 + random() * 0.1;
    // two axes across the star, turned by a random angle about it
    right.set(0, 1, 0).cross(direction);
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    up.crossVectors(direction, right);
    const spin = random() * Math.PI * 2;
    const start = positions.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      const ca = Math.cos(spin) * a - Math.sin(spin) * b;
      const cb = Math.sin(spin) * a + Math.cos(spin) * b;
      corner.copy(direction).multiplyScalar(BODY_DISTANCE).addScaledVector(right, ca * size).addScaledVector(up, cb * size);
      positions.push(corner.x, corner.y, corner.z);
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    made++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

export class Sky {
  /** follows the eye: the sky is always as far as it gets */
  readonly group = new THREE.Group();
  /** the colour the fog fades the land into, as the sky's at the horizon */
  readonly fogColor = new THREE.Color();
  private readonly dome: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  private readonly stars: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly sun: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly moon: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly moonTexture: THREE.Texture;
  private readonly textures: THREE.Texture[] = [];
  private readonly direction = new THREE.Vector3();

  constructor() {
    this.dome = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), domeMaterial());
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;

    this.stars = new THREE.Mesh(starGeometry(), new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -3;

    const sunTexture = loadPixelTexture(sunUrl);
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(SUN_SIZE, SUN_SIZE), bodyMaterial(sunTexture));
    this.moonTexture = loadPixelTexture(moonUrl);
    // moon_phases.png is 4 × 2 phases
    this.moonTexture.repeat.set(1 / 4, 1 / 2);
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(MOON_SIZE, MOON_SIZE), bodyMaterial(this.moonTexture));
    for (const body of [this.sun, this.moon]) {
      body.frustumCulled = false;
      body.renderOrder = -2;
    }
    this.textures.push(sunTexture, this.moonTexture);
    this.group.add(this.dome, this.stars, this.sun, this.moon);
  }

  /** The sky at a clock, around an eye at `eye`. */
  update(clock: number, eye: THREE.Vector3): void {
    this.group.position.copy(eye);
    const { sky, fog } = skyColors(clock);
    this.fogColor.copy(fog);
    const toSun = sunDirection(clock, this.direction);
    const uniforms = this.dome.material.uniforms;
    (uniforms.skyColor!.value as THREE.Color).copy(sky);
    (uniforms.fogColor!.value as THREE.Color).copy(fog);
    const glow = sunriseGlow(clock);
    uniforms.glowStrength!.value = glow?.strength ?? 0;
    if (glow) (uniforms.glowColor!.value as THREE.Color).setRGB(...glow.color, THREE.SRGBColorSpace);
    uniforms.glowSide!.value = toSun.x >= 0 ? 1 : -1;

    // the stars turn with the night, as the sun does
    const brightness = starBrightness(clock);
    this.stars.visible = brightness > 0;
    this.stars.material.opacity = brightness;
    this.stars.rotation.z = celestialAngle(clock) * Math.PI * 2;

    this.sun.position.copy(toSun).multiplyScalar(BODY_DISTANCE);
    this.sun.lookAt(this.group.position);
    this.moon.position.copy(toSun).multiplyScalar(-BODY_DISTANCE);
    this.moon.lookAt(this.group.position);
    // with nothing to hide them at the horizon, they fade as they set
    this.sun.material.opacity = THREE.MathUtils.smoothstep(toSun.y, -0.15, 0.02);
    this.moon.material.opacity = THREE.MathUtils.smoothstep(-toSun.y, -0.15, 0.02);
    const phase = moonPhase(clock);
    this.moonTexture.offset.set((phase % 4) / 4, 1 - (Math.floor(phase / 4) + 1) / 2);
  }

  dispose(): void {
    this.group.removeFromParent();
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    for (const body of [this.sun, this.moon]) {
      body.geometry.dispose();
      body.material.dispose();
    }
    for (const texture of this.textures) texture.dispose();
  }
}

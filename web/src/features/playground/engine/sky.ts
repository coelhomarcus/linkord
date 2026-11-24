import * as THREE from 'three';
import { celestialAngle, DAY_TICKS, daylight, moonPhase, timeOfDay } from '@game/dayTime';
import moonUrl from '../assets/pixel-perfection/environment/moon_phases.png?url';
import sunUrl from '../assets/pixel-perfection/environment/sun.png?url';

// The sky, as Pixel Perfection paints it: three boxes of pictures around the
// view (its `fabricskyboxes/sky/` folder), each shown at its own hours and
// turning slowly about the vertical, laid over the game's sky colour. The day's
// box (`cloudbox`) multiplies that colour, the night's (`nightbox`) and its
// stars (`nightbox2`) add to it, as the pack's own sky1..3.json say; the hours
// and speeds below are theirs. The sky colour, the fog's and the sun's and
// moon's path are the block game's, after minecraft-renderer
// (src/three/skyboxRenderer.ts and modules/sunMoon.ts in
// github.com/zardoy/minecraft-renderer, MIT, Copyright (c) 2020 PrismarineJS):
// the sun and the phase of the moon are the pack's pictures too, added to the
// sky, crossing it from east (+x) to west.

const skyUrls = import.meta.glob('../assets/pixel-perfection/sky/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

/** The faces of a box, in the order its atlas lays them out: three across, two down. */
const FACES = ['east', 'west', 'top', 'bottom', 'south', 'north'] as const;
const FACE_SIZE = 512;

interface Layer {
  /** the pack's name for the box */
  box: 'cloudbox' | 'nightbox' | 'nightbox2';
  /** fully shown from `fullFrom` to `fullTo`, fading over the half hour (500 ticks) before and after */
  fullFrom: number;
  fullTo: number;
  /** turns about the vertical this many times a day */
  turns: number;
}

/** In ticks of the day (0 is 6:00): the pack's 5:30–17:30, 18:00–5:30 and 18:30–5:00. */
export const LAYERS: readonly Layer[] = [
  { box: 'cloudbox', fullFrom: 23_500, fullTo: 11_500, turns: 1 },
  { box: 'nightbox', fullFrom: 12_000, fullTo: 23_500, turns: 1 },
  { box: 'nightbox2', fullFrom: 12_500, fullTo: 23_000, turns: 0.1 },
];
const FADE_TICKS = 500;

/** How much of a layer shows at a time of day, 0..1. */
export function layerFade(layer: Pick<Layer, 'fullFrom' | 'fullTo'>, time: number): number {
  const wrap = (ticks: number) => ((ticks % DAY_TICKS) + DAY_TICKS) % DAY_TICKS;
  const full = wrap(layer.fullTo - layer.fullFrom);
  // ticks since it started to fade in
  const into = wrap(time - layer.fullFrom + FADE_TICKS);
  if (into < FADE_TICKS) return into / FADE_TICKS;
  if (into <= FADE_TICKS + full) return 1;
  return Math.max(0, (full + FADE_TICKS * 2 - into) / FADE_TICKS);
}

/** The game's sky colour where it is warm and green (plains: temperature 0.8), by full day (sRGB). */
const DAY_SKY = [0.4733, 0.6564, 1] as const;
/** The fog's colour by full day (sRGB); it darkens a little less than the sky toward the night. */
const DAY_FOG = [0.7529, 0.8471, 1] as const;
/** how far the fog takes on the sky's colour at the view distance the island needs */
const FOG_TOWARD_SKY = 0.19;

/** The sky's colour and the fog's at a clock, before the pack's pictures are laid over it. */
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

/** Draws the six faces of one box into a 3 × 2 atlas, and the average colour of its horizon. */
async function loadBox(box: Layer['box']): Promise<{ texture: THREE.Texture; horizon: THREE.Color }> {
  const canvas = document.createElement('canvas');
  canvas.width = FACE_SIZE * 3;
  canvas.height = FACE_SIZE * 2;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no canvas');
  await Promise.all(FACES.map(async (face, index) => {
    const url = skyUrls[`../assets/pixel-perfection/sky/${box}_${face}.png`];
    if (!url) throw new Error(`no ${box} ${face}`);
    const image = new Image();
    image.src = url;
    await image.decode();
    ctx.drawImage(image, (index % 3) * FACE_SIZE, Math.floor(index / 3) * FACE_SIZE, FACE_SIZE, FACE_SIZE);
  }));
  // the band just under the middle of the four sides: what the fog fades the land into
  const horizon = new THREE.Color(0, 0, 0);
  let count = 0;
  for (const index of [0, 1, 4, 5]) {
    const x = (index % 3) * FACE_SIZE;
    const y = Math.floor(index / 3) * FACE_SIZE + FACE_SIZE / 2;
    const { data } = ctx.getImageData(x, y, FACE_SIZE, FACE_SIZE / 16);
    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3]! / 255;
      horizon.r += (data[i]! / 255) * alpha;
      horizon.g += (data[i + 1]! / 255) * alpha;
      horizon.b += (data[i + 2]! / 255) * alpha;
      count++;
    }
  }
  horizon.multiplyScalar(1 / count);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  // the horizon sampled in sRGB; the shader works in linear
  horizon.setRGB(horizon.r, horizon.g, horizon.b, THREE.SRGBColorSpace);
  return { texture, horizon };
}

function loadPixelTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function boxMaterial(): THREE.ShaderMaterial {
  const blank = new THREE.Texture();
  return new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    fog: false,
    side: THREE.BackSide,
    uniforms: {
      skyColor: { value: new THREE.Color() },
      maps: { value: [blank, blank, blank] },
      fades: { value: new THREE.Vector3() },
      turns: { value: new THREE.Vector3() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // always at the far end of the view
        gl_Position.z = gl_Position.w;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 skyColor;
      uniform sampler2D maps[3];
      uniform vec3 fades;
      uniform vec3 turns;
      varying vec3 vDirection;

      // a face's (u, v), right and up as seen from inside, and its tile in the 3 x 2 atlas
      vec2 atlasUv(vec3 d) {
        vec3 a = abs(d);
        vec2 uv;
        float tile;
        if (a.x >= a.y && a.x >= a.z) {
          tile = d.x > 0.0 ? 0.0 : 1.0;
          uv = vec2(d.x > 0.0 ? d.z : -d.z, d.y) / a.x;
        } else if (a.y >= a.z) {
          tile = d.y > 0.0 ? 2.0 : 3.0;
          uv = vec2(d.x, d.y > 0.0 ? -d.z : d.z) / a.y;
        } else {
          tile = d.z > 0.0 ? 4.0 : 5.0;
          uv = vec2(d.z > 0.0 ? -d.x : d.x, d.y) / a.z;
        }
        // half a pixel in from the edges, so no face shows its neighbour's
        uv = clamp(uv * 0.5 + 0.5, ${(0.5 / FACE_SIZE).toFixed(6)}, ${(1 - 0.5 / FACE_SIZE).toFixed(6)});
        float column = mod(tile, 3.0);
        // rows counted from the top of the atlas, which the texture flips to the top of v
        float row = floor(tile / 3.0);
        return vec2((column + uv.x) / 3.0, (1.0 - row + uv.y) / 2.0);
      }

      vec3 turned(vec3 d, float angle) {
        float c = cos(angle);
        float s = sin(angle);
        return vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
      }

      void main() {
        vec3 d = normalize(vDirection);
        vec4 day = texture2D(maps[0], atlasUv(turned(d, turns.x)));
        vec4 night = texture2D(maps[1], atlasUv(turned(d, turns.y)));
        vec4 stars = texture2D(maps[2], atlasUv(turned(d, turns.z)));
        vec3 color = skyColor * mix(vec3(1.0), day.rgb, day.a * fades.x);
        color += night.rgb * night.a * fades.y;
        color += stars.rgb * stars.a * fades.z;
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function bodyMaterial(map: THREE.Texture): THREE.MeshBasicMaterial {
  // the game adds the sun and the moon to the sky behind them
  return new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
}

/** the sun's and moon's distance from the eye, and their sizes, the game's */
const BODY_DISTANCE = 100;
const SUN_SIZE = 60;
const MOON_SIZE = 40;

export class Sky {
  /** follows the eye: the sky is always as far as it gets */
  readonly group = new THREE.Group();
  /** the colour the fog fades the land into, matching the sky's horizon */
  readonly fogColor = new THREE.Color();
  private readonly box: THREE.Mesh<THREE.BoxGeometry, THREE.ShaderMaterial>;
  private readonly sun: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly moon: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private readonly moonTexture: THREE.Texture;
  private readonly horizons: (THREE.Color | null)[] = [null, null, null];
  private readonly textures: THREE.Texture[] = [];
  private readonly direction = new THREE.Vector3();
  private disposed = false;

  constructor() {
    this.box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), boxMaterial());
    this.box.frustumCulled = false;
    this.box.renderOrder = -10;

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
    this.group.add(this.box, this.sun, this.moon);

    LAYERS.forEach((layer, index) => {
      void loadBox(layer.box).then(({ texture, horizon }) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }
        this.textures.push(texture);
        (this.box.material.uniforms.maps!.value as THREE.Texture[])[index] = texture;
        this.horizons[index] = horizon;
      }).catch(() => {
        // that layer stays out: the plain sky colour shows
      });
    });
  }

  /** The sky at a clock, around an eye at `eye`. */
  update(clock: number, eye: THREE.Vector3): void {
    this.group.position.copy(eye);
    const time = timeOfDay(clock);
    const { sky, fog } = skyColors(clock);
    const uniforms = this.box.material.uniforms;
    (uniforms.skyColor!.value as THREE.Color).copy(sky);
    const fades = LAYERS.map((layer, index) => (this.horizons[index] ? layerFade(layer, time) : 0));
    (uniforms.fades!.value as THREE.Vector3).set(fades[0]!, fades[1]!, fades[2]!);
    const day = clock / DAY_TICKS;
    (uniforms.turns!.value as THREE.Vector3).set(...LAYERS.map((layer) => (day * layer.turns % 1) * Math.PI * 2) as [number, number, number]);

    // the fog meets the sky where they touch: its colour as the boxes tint the horizon
    const [dayHorizon, nightHorizon, starHorizon] = this.horizons;
    this.fogColor.copy(fog);
    if (dayHorizon) this.fogColor.multiply(new THREE.Color(1, 1, 1).lerp(dayHorizon, fades[0]!));
    if (nightHorizon) this.fogColor.add(nightHorizon.clone().multiplyScalar(fades[1]!));
    if (starHorizon) this.fogColor.add(starHorizon.clone().multiplyScalar(fades[2]!));

    const toSun = sunDirection(clock, this.direction);
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
    this.disposed = true;
    this.group.removeFromParent();
    this.box.geometry.dispose();
    this.box.material.dispose();
    for (const body of [this.sun, this.moon]) {
      body.geometry.dispose();
      body.material.dispose();
    }
    for (const texture of this.textures) texture.dispose();
  }
}

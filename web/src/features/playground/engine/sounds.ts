import { BLOCK } from '@game/blocks';

// The playground's sounds, the block game's way: what a block sounds like when
// it is walked on, dug, broken or placed comes from what it is made of; a
// sound in the world is heard from where it happens, fading out over 16 blocks;
// each plays one of its recordings picked at random. The recordings are
// Enhanced Audio's (assets/enhanced-audio/, by Frawzy), used for now and to be
// replaced. Volumes and pitches follow the game's (SoundType and its uses).

const FILES = import.meta.glob<string>('../assets/enhanced-audio/**/*.ogg', { eager: true, query: '?url', import: 'default' });

/** The recordings whose names start with `stem` and go on with a number, or with nothing (`chest/open`). */
function recordings(stem: string): string[] {
  const prefix = `../assets/enhanced-audio/${stem}`;
  return Object.entries(FILES)
    .filter(([path]) => path.startsWith(prefix) && /^\d*\.ogg$/.test(path.slice(prefix.length)))
    .map(([, url]) => url);
}

/** What a block is made of, for its sounds. */
export type Material = 'grass' | 'gravel' | 'stone' | 'wood' | 'sand' | 'glass' | 'cloth';

const WOOL_FIRST = BLOCK.whiteWool;
const WOOL_LAST = BLOCK.blackWool;

/** The material a block sounds like (dirt crunches like gravel, as in the game). */
export function materialOf(block: number): Material | null {
  switch (block) {
    case BLOCK.air:
    case BLOCK.water:
      return null;
    case BLOCK.grass:
    case BLOCK.leaves:
      return 'grass';
    case BLOCK.dirt:
    case BLOCK.gravel:
      return 'gravel';
    case BLOCK.sand:
      return 'sand';
    case BLOCK.log:
    case BLOCK.planks:
    case BLOCK.craftingTable:
    case BLOCK.chest:
    case BLOCK.torch:
      return 'wood';
    case BLOCK.glass:
    case BLOCK.glowstone:
      return 'glass';
    default:
      return block >= WOOL_FIRST && block <= WOOL_LAST ? 'cloth' : 'stone';
  }
}

interface Sound {
  urls: string[];
  /** as the game plays it, before the caller's own volume and pitch */
  volume: number;
  pitch: number;
}

const sound = (stems: string | string[], volume = 1, pitch = 1): Sound =>
  ({ urls: (Array.isArray(stems) ? stems : [stems]).flatMap(recordings), volume, pitch });

const MATERIALS: readonly Material[] = ['grass', 'gravel', 'stone', 'wood', 'sand', 'glass', 'cloth'];
const byMaterial = (make: (material: Material) => Sound) =>
  Object.fromEntries(MATERIALS.map((material) => [material, make(material)])) as Record<Material, Sound>;

/** Each material's footsteps, digging, breaking and placing (the pack has no wood or cloth of some). */
const STEP = byMaterial((m) => sound(`step/${m}`));
const HIT = byMaterial((m) => (m === 'gravel' || m === 'cloth' ? sound(`step/${m}`) : sound(`block/${m}/hit`, 1, m === 'stone' ? 1.3 : m === 'wood' ? 1.4 : 1.5)));
const BREAK = byMaterial((m) => (m === 'glass' ? sound('random/glass') : m === 'cloth' ? sound('dig/cloth') : sound(`block/${m}/break`, 1, m === 'wood' ? 1.2 : 1)));
const PLACE = byMaterial((m) => (m === 'wood' ? sound('block/wood/break', 1, 1.2) : sound(`dig/${m}`)));

export const SOUNDS = {
  chestOpen: sound('block/chest/open', 0.5),
  chestClose: sound('block/chest/close', 0.5),
  pickup: sound(['random/pop', 'random/pop2', 'random/pop3'], 0.2),
  levelUp: sound('random/levelup', 0.75),
  splash: sound(['liquid/splash', 'liquid/splash2'], 0.4),
  swim: sound('liquid/swim', 0.25),
  hurt: sound('damage/hit'),
  crit: sound('entity/player/attack/crit'),
  fallSmall: sound('damage/fallsmall'),
  fallBig: sound('damage/fallbig'),
  eat: sound('random/eat'),
  burp: sound('random/burp'),
} as const;
export type SoundName = keyof typeof SOUNDS;

/** a sound in the world is heard this far (blocks), quieter as it gets further */
const HEARD_WITHIN = 16;
/** the game's own sounds against the call's voices */
const MASTER_VOLUME = 0.6;

/** The game's footsteps: one every 1/0.6 blocks walked on the ground (Entity.move). */
export class Footsteps {
  private walked = 0;
  private next = 1;

  /** `moved` blocks along the ground this tick; true when a step sounds. */
  step(moved: number): boolean {
    this.walked += moved * 0.6;
    if (this.walked < this.next) return false;
    this.next = Math.floor(this.walked) + 1;
    return true;
  }
}

export interface Place { x: number; y: number; z: number }

export class GameSounds {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private muted = false;
  private disposed = false;

  /** Browsers start sound only after a click or a key: called on each, it starts once. */
  unlock(): void {
    if (this.disposed || typeof AudioContext === 'undefined') return;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {});
  }

  /** Deafened in the call: the game is silent too. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : MASTER_VOLUME;
  }

  /** Where the ears are and which way they face. */
  listen(x: number, y: number, z: number, forward: Place, up: Place): void {
    const listener = this.context?.listener;
    if (!listener) return;
    if (listener.positionX) {
      listener.positionX.value = x; listener.positionY.value = y; listener.positionZ.value = z;
      listener.forwardX.value = forward.x; listener.forwardY.value = forward.y; listener.forwardZ.value = forward.z;
      listener.upX.value = up.x; listener.upY.value = up.y; listener.upZ.value = up.z;
    } else {
      // Firefox's older listener
      listener.setPosition(x, y, z);
      listener.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  footstep(material: Material, at: Place | null, volume = 0.15): void {
    this.play(STEP[material], at, volume, 1);
  }

  /** A tick of digging, every four as the game does. */
  dig(material: Material, at: Place): void {
    this.play(HIT[material], at, 0.25, 0.5);
  }

  broken(material: Material, at: Place): void {
    this.play(BREAK[material], at, 1, 0.8);
  }

  placed(material: Material, at: Place): void {
    this.play(PLACE[material], at, 1, 0.8);
  }

  /** A named sound, from `at` in the world or right in the ears (null). */
  sound(name: SoundName, at: Place | null = null, volume = 1, pitch = 1): void {
    this.play(SOUNDS[name], at, volume, pitch);
  }

  private play(sound: Sound, at: Place | null, volume: number, pitch: number): void {
    const context = this.context;
    if (!context || !this.master || this.muted || context.state !== 'running' || sound.urls.length === 0) return;
    const url = sound.urls[Math.floor(Math.random() * sound.urls.length)]!;
    void this.buffer(url).then((buffer) => {
      if (!buffer || this.disposed) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = sound.pitch * pitch;
      const gain = context.createGain();
      gain.gain.value = Math.min(1, sound.volume * volume);
      source.connect(gain);
      if (at) {
        const panner = new PannerNode(context, {
          panningModel: 'equalpower', distanceModel: 'linear', refDistance: 1, maxDistance: HEARD_WITHIN, rolloffFactor: 1,
          positionX: at.x, positionY: at.y, positionZ: at.z,
        });
        gain.connect(panner).connect(this.master!);
      } else {
        gain.connect(this.master!);
      }
      source.start();
    });
  }

  private buffer(url: string): Promise<AudioBuffer | null> {
    let pending = this.buffers.get(url);
    if (!pending) {
      pending = fetch(url)
        .then((response) => response.arrayBuffer())
        .then((bytes) => this.context!.decodeAudioData(bytes))
        .catch(() => null);
      this.buffers.set(url, pending);
    }
    return pending;
  }

  dispose(): void {
    this.disposed = true;
    void this.context?.close().catch(() => {});
    this.context = null;
  }
}

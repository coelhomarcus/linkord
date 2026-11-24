import { MAX_HEIGHT, WORLD_RADIUS } from './playgroundWorld';

// What each client sends the others about its avatar, over LiveKit's data
// channel (lossy: a lost packet is replaced by the next one a few dozen ms
// later). The server only opens that channel in a playground and never reads
// it, so everything received is checked and clamped here: a peer can at worst
// misplace its own avatar inside the world.

export const PLAYGROUND_TOPIC = 'linkord.playground';
/** reliable packets carrying a skin PNG (playgroundSession.ts) */
export const SKIN_TOPIC = 'linkord.playground.skin';
const VERSION = 1;

export const MOTIONS = ['idle', 'walk', 'run', 'jump'] as const;
export type Motion = (typeof MOTIONS)[number];

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  /** where the avatar faces, radians around +y */
  yaw: number;
  /** how far up (positive) or down the head looks, radians */
  pitch: number;
  motion: Motion;
  /** where the head faces, radians like `yaw`; the body (`yaw`) follows it loosely */
  headYaw: number;
  /** sneaking: the model bends */
  crouch: boolean;
  /** counts the arm's swings, so the others play each one (wraps at 256) */
  swings: number;
}

const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, min: number, max: number) => Math.min(Math.max(n, min), max);
const MAX_PITCH = Math.PI / 2;

export function encodeState(state: PlayerState): Uint8Array<ArrayBuffer> {
  const packet = {
    v: VERSION, p: [round(state.x), round(state.y), round(state.z)], r: round(state.yaw), h: round(state.pitch), m: MOTIONS.indexOf(state.motion),
    t: round(state.headYaw), c: state.crouch ? 1 : 0, s: state.swings & 0xff,
  };
  return new TextEncoder().encode(JSON.stringify(packet));
}

// far more than a packet ever needs; anything larger is not ours
const MAX_PACKET_BYTES = 256;

export function decodeState(bytes: Uint8Array): PlayerState | null {
  if (bytes.byteLength > MAX_PACKET_BYTES) return null;
  let packet: unknown;
  try {
    packet = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!packet || typeof packet !== 'object') return null;
  const { v, p, r, h, m, t, c, s } = packet as Record<string, unknown>;
  if (v !== VERSION || !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite) || !Number.isFinite(r)) return null;
  const [x, y, z] = (p as number[]).map((n, i) => (i === 1 ? clamp(n, 0, MAX_HEIGHT) : clamp(n, -WORLD_RADIUS, WORLD_RADIUS)));
  const motion = typeof m === 'number' && MOTIONS[m] ? MOTIONS[m] : 'idle';
  // the head's pitch came later in the same version; a packet without it looks straight ahead
  const pitch = Number.isFinite(h) ? clamp(h as number, -MAX_PITCH, MAX_PITCH) : 0;
  // so did the head's own heading, the sneak and the swings: without them the head looks where the body faces
  const headYaw = Number.isFinite(t) ? (t as number) : (r as number);
  const swings = Number.isInteger(s) ? (s as number) & 0xff : 0;
  return { x: x!, y: y!, z: z!, yaw: r as number, pitch, motion, headYaw, crouch: c === 1, swings };
}

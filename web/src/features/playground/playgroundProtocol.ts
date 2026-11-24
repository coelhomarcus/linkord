import { MAX_HEIGHT, WORLD_RADIUS } from './playgroundWorld';

// What each client sends the others about its avatar, over LiveKit's data
// channel (lossy: a lost packet is replaced by the next one a few dozen ms
// later). The server only opens that channel in a playground and never reads
// it, so everything received is checked and clamped here: a peer can at worst
// misplace its own avatar inside the world.

export const PLAYGROUND_TOPIC = 'linkord.playground';
const VERSION = 1;

export const MOTIONS = ['idle', 'walk', 'run', 'jump'] as const;
export type Motion = (typeof MOTIONS)[number];

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  /** where the avatar faces, radians around +y */
  yaw: number;
  motion: Motion;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function encodeState(state: PlayerState): Uint8Array<ArrayBuffer> {
  const packet = { v: VERSION, p: [round(state.x), round(state.y), round(state.z)], r: round(state.yaw), m: MOTIONS.indexOf(state.motion) };
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
  const { v, p, r, m } = packet as Record<string, unknown>;
  if (v !== VERSION || !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite) || !Number.isFinite(r)) return null;
  let [x, y, z] = p as number[];
  const distance = Math.hypot(x, z);
  if (distance > WORLD_RADIUS) {
    x = (x / distance) * WORLD_RADIUS;
    z = (z / distance) * WORLD_RADIUS;
  }
  y = Math.min(Math.max(y, 0), MAX_HEIGHT);
  const motion = typeof m === 'number' && MOTIONS[m] ? MOTIONS[m] : 'idle';
  return { x, y, z, yaw: r as number, motion };
}

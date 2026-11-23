import { processName, type DetectedActivity } from './activityDetect.js';

// Discord's local RPC, as games speak it to the Discord client: frames over a pipe named
// `discord-ipc-<0..9>`, a handshake naming the game's Discord application, then `SET_ACTIVITY`
// commands carrying its Rich Presence. richPresenceServer.ts owns the pipe; this file reads and
// answers what comes through it and decides which detected activity a game's presence belongs to.
// Everything a game sends is untrusted (any local program can write to the pipe) and is cut down
// to the few fields shown, at the lengths Discord itself allows.

export const OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 } as const;
/** a Rich Presence update is well under 4 KB; anything this large is not a game talking */
export const MAX_FRAME_BYTES = 64 * 1024;
const HEADER_BYTES = 8;

/** The programs that are Discord itself, which keeps the pipe whenever it runs. */
const DISCORD_PROCESSES: readonly string[] = ['discord.exe', 'discordptb.exe', 'discordcanary.exe', 'discorddevelopment.exe'];

export function isDiscordProcess(path: string): boolean {
  return DISCORD_PROCESSES.includes(processName(path));
}

/** Where Discord's pipe with this index lives on Windows. */
export function windowsPipePath(index: number): string {
  return `\\\\?\\pipe\\discord-ipc-${index}`;
}

export const PIPE_COUNT = 10;

export interface Frame {
  op: number;
  data: unknown;
}

export function encodeFrame(op: number, data: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

/** Reads frames out of a stream that may split or join them anywhere. `invalid` means the
 * connection should be dropped: a frame too large, or one that is not JSON. */
export function createFrameDecoder() {
  let pending: Buffer = Buffer.alloc(0);
  return {
    push(chunk: Buffer): { frames: Frame[]; invalid: boolean } {
      pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
      const frames: Frame[] = [];
      while (pending.length >= HEADER_BYTES) {
        const op = pending.readUInt32LE(0);
        const length = pending.readUInt32LE(4);
        if (length > MAX_FRAME_BYTES) return { frames, invalid: true };
        if (pending.length < HEADER_BYTES + length) break;
        const body = pending.subarray(HEADER_BYTES, HEADER_BYTES + length).toString('utf8');
        pending = pending.subarray(HEADER_BYTES + length);
        try {
          frames.push({ op, data: JSON.parse(body) as unknown });
        } catch {
          return { frames, invalid: true };
        }
      }
      return { frames, invalid: false };
    },
  };
}

const APPLICATION_ID = /^\d{17,20}$/;

/** The Discord application id a game names in its handshake, or null for anything else. */
export function parseHandshake(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const { v, client_id: clientId } = data as { v?: unknown; client_id?: unknown };
  if (Number(v) !== 1 || typeof clientId !== 'string' || !APPLICATION_ID.test(clientId)) return null;
  return clientId;
}

/** What Discord answers a handshake with. Games read the user only to greet them, so it is a
 * stand-in: nothing about the Linkord account ever goes back to the game. */
export function readyMessage() {
  return {
    cmd: 'DISPATCH',
    evt: 'READY',
    nonce: null,
    data: {
      v: 1,
      config: { cdn_host: 'cdn.discordapp.com', api_endpoint: '//discord.com/api', environment: 'production' },
      user: { id: '100000000000000000', username: 'linkord', discriminator: '0', global_name: 'Linkord', avatar: null, bot: false, flags: 0, premium_type: 0 },
    },
  };
}

/** The close frame for a handshake refused, as Discord sends it. */
export function invalidHandshakeMessage() {
  return { code: 4000, message: 'Invalid client ID' };
}

interface RichPresenceImage {
  /** an asset name of the game's Discord application, an `https:` URL, or `mp:external/...` */
  key: string;
  text?: string;
}

/** The parts of a game's Rich Presence that are shown. */
export interface RichPresence {
  details?: string;
  state?: string;
  largeImage?: RichPresenceImage;
  smallImage?: RichPresenceImage;
  party?: { size: number; max: number };
  /** ms, this computer's clock */
  timestamps?: { start?: number; end?: number };
  buttons?: { label: string; url: string }[];
}

/** A game's current presence, as one connection reported it. */
interface ReportedActivity {
  /** the game's process, when it said */
  pid: number | null;
  kind: 'playing' | 'using';
  /** absent when nothing it sent is shown */
  rich?: RichPresence;
}

const TEXT_MAX = 128;
const LABEL_MAX = 32;
const URL_MAX = 512;
const IMAGE_KEY = /^[\w.-]{1,128}$/;
const PARTY_MAX = 1_000_000;
// a timestamp below this is in seconds (2001-09 in ms), as most libraries send it
const SECONDS_BELOW = 1e12;

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const clean = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  const cut = Array.from(clean).slice(0, max).join('').trim();
  return cut || undefined;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > URL_MAX) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function imageKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('mp:external/')) return value.length <= URL_MAX && !/[\s\p{Cc}]/u.test(value) ? value : undefined;
  if (value.startsWith('https:')) return httpsUrl(value);
  return IMAGE_KEY.test(value) ? value : undefined;
}

function image(key: unknown, label: unknown): RichPresenceImage | undefined {
  const valid = imageKey(key);
  if (!valid) return undefined;
  const caption = text(label, TEXT_MAX);
  return caption ? { key: valid, text: caption } : { key: valid };
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value < SECONDS_BELOW ? value * 1000 : value);
}

function party(value: unknown): RichPresence['party'] {
  const size = (value as { size?: unknown } | null)?.size;
  if (!Array.isArray(size) || size.length !== 2) return undefined;
  const [current, max] = size as unknown[];
  if (!Number.isSafeInteger(current) || !Number.isSafeInteger(max)) return undefined;
  const [c, m] = [current as number, max as number];
  return c >= 1 && c <= m && m <= PARTY_MAX ? { size: c, max: m } : undefined;
}

function buttons(value: unknown): RichPresence['buttons'] {
  if (!Array.isArray(value)) return undefined;
  const valid = value.slice(0, 2).flatMap((button: unknown) => {
    const { label, url } = (button ?? {}) as { label?: unknown; url?: unknown };
    const name = text(label, LABEL_MAX);
    const link = httpsUrl(url);
    return name && link ? [{ label: name, url: link }] : [];
  });
  return valid.length > 0 ? valid : undefined;
}

/** The shown parts of an activity object from `SET_ACTIVITY`, or undefined when none is valid. */
export function sanitizeRichPresence(raw: unknown): RichPresence | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const activity = raw as Record<string, unknown>;
  const assets = (activity.assets ?? {}) as Record<string, unknown>;
  const times = (activity.timestamps ?? {}) as Record<string, unknown>;
  const start = timestamp(times.start);
  let end = timestamp(times.end);
  if (start !== undefined && end !== undefined && end <= start) end = undefined;
  const rich: RichPresence = {
    details: text(activity.details, TEXT_MAX),
    state: text(activity.state, TEXT_MAX),
    largeImage: image(assets.large_image, assets.large_text),
    smallImage: image(assets.small_image, assets.small_text),
    party: party(activity.party),
    timestamps: start !== undefined || end !== undefined ? { ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) } : undefined,
    buttons: buttons(activity.buttons),
  };
  for (const key of Object.keys(rich) as (keyof RichPresence)[]) if (rich[key] === undefined) delete rich[key];
  return Object.keys(rich).length > 0 ? rich : undefined;
}

/** Discord's activity types: listening (2) and watching (3) read as "using", the rest as playing. */
function kindOf(type: unknown): 'playing' | 'using' {
  return type === 2 || type === 3 ? 'using' : 'playing';
}

export type CommandResult =
  /** `activity: null` clears the game's presence */
  | { kind: 'set-activity'; activity: ReportedActivity | null; reply: unknown }
  | { kind: 'reply'; reply: unknown };

/** What a command frame does and what to answer. Only `SET_ACTIVITY` changes anything; subscribing
 * to events is acknowledged (no event ever comes), and anything else is refused as Discord would. */
export function handleCommand(message: unknown): CommandResult {
  const { cmd, args, nonce, evt } = (message && typeof message === 'object' ? message : {}) as { cmd?: unknown; args?: unknown; nonce?: unknown; evt?: unknown };
  const name = typeof cmd === 'string' ? cmd.slice(0, 64) : null;
  const id = typeof nonce === 'string' ? nonce.slice(0, 64) : null;
  if (name === 'SET_ACTIVITY') {
    const { pid, activity } = (args && typeof args === 'object' ? args : {}) as { pid?: unknown; activity?: unknown };
    let reported: ReportedActivity | null = null;
    if (activity && typeof activity === 'object') {
      reported = { pid: Number.isSafeInteger(pid) && (pid as number) > 0 ? pid as number : null, kind: kindOf((activity as { type?: unknown }).type) };
      const rich = sanitizeRichPresence(activity);
      if (rich) reported.rich = rich;
    }
    return { kind: 'set-activity', activity: reported, reply: { cmd: name, evt: null, nonce: id, data: reported ? activity : null } };
  }
  if (name === 'SUBSCRIBE' || name === 'UNSUBSCRIBE') {
    return { kind: 'reply', reply: { cmd: name, evt: null, nonce: id, data: { evt: typeof evt === 'string' ? evt.slice(0, 64) : null } } };
  }
  return { kind: 'reply', reply: { cmd: name, evt: 'ERROR', nonce: id, data: { code: 4000, message: 'Unsupported command' } } };
}

/** One game connected to the pipe with a presence set. */
export interface RichSession extends ReportedActivity {
  /** the game's Discord application */
  clientId: string;
  /** ms, when it was last set: the newest wins when two report for the same game */
  updatedAt: number;
}

const normalizePath = (value: string) => value.replace(/\\/g, '/').toLowerCase();

/**
 * The detected activities with each game's Rich Presence attached. A presence belongs to the
 * activity whose processes include the game's pid, else to the running Steam game when the pid's
 * program sits in its folder; that activity keeps its key (so hiding, picking and history do not
 * change) and gains `rich` and `discordAppId`. A presence that belongs to none is an activity of
 * its own, `discord:<application id>`, named by the server.
 */
export function attachRichPresence(input: {
  candidates: readonly DetectedActivity[];
  sessions: readonly RichSession[];
  /** the running Steam game's folder, when known */
  steamInstallDir?: string | null;
  /** the program file of a session's pid, where it was looked up */
  exePaths?: ReadonlyMap<number, string>;
}): DetectedActivity[] {
  const result = input.candidates.map((candidate) => ({ ...candidate }));
  const steamDir = input.steamInstallDir ? `${normalizePath(input.steamInstallDir).replace(/\/+$/, '')}/` : null;
  const newestFirst = [...input.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const taken = new Set<string>();
  for (const session of newestFirst) {
    const exePath = session.pid !== null ? input.exePaths?.get(session.pid) : undefined;
    const owner = (session.pid !== null ? result.find((c) => c.pids.includes(session.pid!)) : undefined)
      ?? (steamDir && exePath && normalizePath(exePath).startsWith(steamDir) ? result.find((c) => c.steamAppId !== undefined) : undefined);
    if (owner) {
      if (taken.has(owner.key)) continue;
      taken.add(owner.key);
      owner.discordAppId = session.clientId;
      if (session.rich) owner.rich = session.rich;
      continue;
    }
    const key = `discord:${session.clientId}`;
    if (taken.has(key)) continue;
    taken.add(key);
    result.push({
      key,
      kind: session.kind,
      name: '',
      discordAppId: session.clientId,
      ...(session.rich ? { rich: session.rich } : {}),
      ...(session.pid !== null ? { pid: session.pid, pids: [session.pid] } : { pids: [] }),
      ...(exePath ? { exePath } : {}),
    });
  }
  return result;
}

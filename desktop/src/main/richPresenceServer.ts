import net from 'node:net';
import {
  createFrameDecoder, encodeFrame, handleCommand, invalidHandshakeMessage, OP, parseHandshake, PIPE_COUNT,
  readyMessage, windowsPipePath, type RichSession,
} from './richPresence.js';

// Listens where games look for Discord (`discord-ipc-0`) and keeps the Rich Presence each one sets
// (richPresence.ts reads and answers the frames). It never takes the pipe from Discord: it listens
// only while no other program holds any `discord-ipc-N`, and the watcher calls `yield()` the moment
// Discord runs, which drops every game; their libraries reconnect, and find Discord.

const MAX_CONNECTIONS = 10;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const PROBE_TIMEOUT_MS = 1_000;
/** a game may update its presence every second; others see at most one change per this long
 * (Discord allows a game 5 updates per 20 s) */
const CONTENT_THROTTLE_MS = 5_000;

/** Whether some program holds this pipe. A pipe that is there but busy, or refuses for another
 * reason, counts as held: only "nothing there" leaves it free. */
function probe(pipe: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(pipe);
    const done = (held: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(held);
    };
    const timer = setTimeout(() => done(true), PROBE_TIMEOUT_MS);
    socket.once('connect', () => done(true));
    socket.once('error', (error: NodeJS.ErrnoException) => done(error.code !== 'ENOENT' && error.code !== 'ECONNREFUSED'));
  });
}

export function createRichPresenceServer(options: {
  /** `structural`: a game started or stopped sending presence, rather than changing what it says */
  onChange: (structural: boolean) => void;
  pipePath?: (index: number) => string;
  now?: () => number;
  throttleMs?: number;
}) {
  const pipePath = options.pipePath ?? windowsPipePath;
  const now = options.now ?? Date.now;
  const throttleMs = options.throttleMs ?? CONTENT_THROTTLE_MS;
  const sessions = new Map<net.Socket, RichSession>();
  const sockets = new Set<net.Socket>();
  let server: net.Server | null = null;
  let enabled = false;
  let ensuring: Promise<void> | null = null;
  let lastEmit = -Infinity;
  let trailing: NodeJS.Timeout | null = null;

  const emit = (structural: boolean) => {
    if (trailing) clearTimeout(trailing);
    trailing = null;
    lastEmit = now();
    options.onChange(structural);
  };

  const changed = (structural: boolean) => {
    if (structural) return emit(true);
    const wait = lastEmit + throttleMs - now();
    if (wait <= 0) emit(false);
    else trailing ??= setTimeout(() => emit(false), wait);
  };

  function accept(socket: net.Socket) {
    sockets.add(socket);
    const decoder = createFrameDecoder();
    let clientId: string | null = null;
    const handshakeTimer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS);
    const send = (op: number, data: unknown) => { if (!socket.destroyed) socket.write(encodeFrame(op, data)); };

    socket.on('data', (chunk: Buffer) => {
      const { frames, invalid } = decoder.push(chunk);
      for (const frame of frames) {
        if (socket.destroyed) return;
        if (!clientId) {
          clientId = frame.op === OP.handshake ? parseHandshake(frame.data) : null;
          if (!clientId) {
            send(OP.close, invalidHandshakeMessage());
            socket.end();
            return;
          }
          clearTimeout(handshakeTimer);
          send(OP.frame, readyMessage());
          continue;
        }
        if (frame.op === OP.ping) send(OP.pong, frame.data);
        else if (frame.op === OP.close) socket.end();
        else if (frame.op === OP.frame) {
          const result = handleCommand(frame.data);
          send(OP.frame, result.reply);
          if (result.kind !== 'set-activity') continue;
          const had = sessions.get(socket);
          if (!result.activity) {
            if (had) {
              sessions.delete(socket);
              changed(true);
            }
            continue;
          }
          sessions.set(socket, { ...result.activity, clientId, updatedAt: now() });
          changed(!had || had.pid !== result.activity.pid || had.kind !== result.activity.kind);
        } else socket.destroy();
      }
      if (invalid) socket.destroy();
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      clearTimeout(handshakeTimer);
      sockets.delete(socket);
      if (sessions.delete(socket)) changed(true);
    });
  }

  function dropAll() {
    const had = sessions.size > 0;
    server?.close();
    server = null;
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    sessions.clear();
    if (trailing) clearTimeout(trailing);
    trailing = null;
    return had;
  }

  async function listen(): Promise<void> {
    const held = await Promise.all(Array.from({ length: PIPE_COUNT }, (_, i) => probe(pipePath(i))));
    if (!enabled || server || held.some(Boolean)) return;
    const next = net.createServer(accept);
    next.maxConnections = MAX_CONNECTIONS;
    await new Promise<void>((resolve) => {
      // taken between the probe and now (Discord starting): stay off and look again next time
      next.once('error', () => resolve());
      next.listen(pipePath(0), () => {
        next.removeAllListeners('error');
        next.on('error', () => {});
        if (enabled && !server) server = next;
        else next.close();
        resolve();
      });
    });
  }

  /** Discord or another client appeared beside the pipe this one holds. */
  async function othersPresent(): Promise<boolean> {
    const held = await Promise.all(Array.from({ length: PIPE_COUNT - 1 }, (_, i) => probe(pipePath(i + 1))));
    return held.some(Boolean);
  }

  /** Lets go of the pipe for Discord; `ensure()` takes it again once Discord is gone. */
  function yieldPipe(): void {
    if (dropAll()) emit(true);
  }

  return {
    /** Listens if nothing else holds a Discord pipe, and lets go if something now does. */
    ensure(): Promise<void> {
      enabled = true;
      ensuring ??= (async () => {
        try {
          if (!server) await listen();
          else if (await othersPresent()) yieldPipe();
        } finally {
          ensuring = null;
        }
      })();
      return ensuring;
    },
    yield: yieldPipe,
    /** Stops for good until the next `ensure()`, without announcing anything. */
    close(): void {
      enabled = false;
      dropAll();
    },
    listening: () => server !== null,
    /** the games with a presence set, oldest first */
    sessions: (): RichSession[] => [...sessions.values()].sort((a, b) => a.updatedAt - b.updatedAt),
  };
}

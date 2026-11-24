import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { verifyPlaygroundToken } from './access.js';
import { admit, allPlayers, isCurrent, playerFor, remove, type Player } from './roster.js';
import { handleAttack, handleEat, handleEatStart, handlePosition, handleRespawn, playerJoined, playerLeft, sweepFighters, tickVitals } from './combat.js';
import { handleSkinGet, handleSkinSet } from './skins.js';
import { buildingLeft, handleBreak, handleDigStart, handleInventoryOp, handlePlace, handleUse, handleWorldGet, maintainGame, tickGame } from './building.js';
import { inventoryOf } from './inventories.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'socket' });

/** Where browsers connect; a proxy on the app's own domain sends this path here. */
const SOCKET_PATH = '/playground/ws';
// game messages are a few numbers each; the largest is a skin (14 kB as PNG, a third more in base64).
// The world itself only goes out (`world-get`'s answer), which this does not limit.
const MAX_MESSAGE_BYTES = 32 * 1024;
const SWEEP_MS = 5000;
/** the game's own clock: furnaces, items on the ground, pickups, air and hunger */
const GAME_TICK_MS = 100;
const MAINTAIN_MS = 1000;

// Per connection: a client reports its position at most ~7 times a second and punches once per click;
// a dropped one is replaced by the next. Renewal is twice a minute.
interface Limit { windowMs: number; max: number }
const LIMITS: Record<string, Limit> = {
  'playground-pos': { windowMs: 10_000, max: 120 },
  'playground-attack': { windowMs: 10_000, max: 120 },
  'playground-respawn': { windowMs: 10_000, max: 10 },
  // a meal takes 32 ticks: at most six in ten seconds, and the starts of a few given up
  'eat-start': { windowMs: 10_000, max: 30 },
  eat: { windowMs: 10_000, max: 15 },
  renew: { windowMs: 60_000, max: 10 },
  // one per person who shows up in the call, and its retries
  'skin-get': { windowMs: 10_000, max: 60 },
  'skin-set': { windowMs: 60_000, max: 10 },
  // the world on arrival, and again after a reconnect
  'world-get': { windowMs: 60_000, max: 6 },
  // a block breaks at most every 5 ticks (instant ones), clicks in an inventory come fast
  'dig-start': { windowMs: 10_000, max: 150 },
  'block-break': { windowMs: 10_000, max: 80 },
  'block-place': { windowMs: 10_000, max: 80 },
  'block-use': { windowMs: 10_000, max: 30 },
  'inv-op': { windowMs: 10_000, max: 300 },
};

type Ack = (answer: Record<string, unknown>) => void;
type Handler = (player: Player, payload: Record<string, unknown>, ack: Ack) => unknown;
const HANDLERS: Record<string, Handler> = {
  'playground-pos': handlePosition,
  'playground-attack': handleAttack,
  'playground-respawn': (player) => handleRespawn(player),
  'eat-start': (player) => handleEatStart(player),
  eat: (player, msg) => handleEat(player, msg),
  'skin-get': handleSkinGet,
  'skin-set': handleSkinSet,
  'world-get': handleWorldGet,
  'dig-start': (player, msg) => handleDigStart(player, msg),
  'block-break': (player, msg) => handleBreak(player, msg),
  'block-place': (player, msg) => handlePlace(player, msg),
  'block-use': (player, msg) => handleUse(player, msg),
  'inv-op': (player, msg) => handleInventoryOp(player, msg),
};
const noAck: Ack = () => {};

interface Window { start: number; count: number }

function allow(windows: Map<string, Window>, event: string, now: number): boolean {
  const limit = LIMITS[event];
  if (!limit) return true;
  const window = windows.get(event);
  if (!window || now - window.start >= limit.windowMs) {
    windows.set(event, { start: now, count: 1 });
    return true;
  }
  window.count++;
  return window.count <= limit.max;
}

function run(event: string, fn: () => unknown): void {
  try {
    const result = fn();
    if (result instanceof Promise) result.catch((err: unknown) => log.error('error in socket handler', err, { event }));
  } catch (err) {
    log.error('error in socket handler', err, { event });
  }
}

/** A new pass for the same connection in the same call pushes its expiry back; anything else is ignored. */
function renew(player: Player, token: unknown, secret: string): void {
  const claims = verifyPlaygroundToken(token, secret, Date.now());
  if (!claims || claims.pid !== player.id || claims.uid !== player.userId || claims.cid !== player.conversationId) return;
  player.expiresAt = Math.max(player.expiresAt, claims.exp);
}

/** Closes connections whose pass ran out: the app stopped renewing it, so they left the call or lost the
 * channel. Their client asks the app for a new one and, if it still may, comes back. */
function sweep(now: number): void {
  for (const player of allPlayers()) {
    if (player.expiresAt > now) continue;
    log.debug('pass expired', { participantId: player.id });
    try { player.socket.disconnect(true); } catch { /* already gone */ }
  }
  sweepFighters(now);
}

export function createPlaygroundSocket(httpServer: HttpServer, secret: string): { io: Server; stop: () => void } {
  const io = new Server(httpServer, {
    path: SOCKET_PATH,
    // websocket only: no long-polling requests, so another origin needs no CORS, and the pass in the
    // handshake (not a cookie) is what authenticates
    transports: ['websocket'],
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
  });

  io.use((socket: Socket, next) => {
    const claims = verifyPlaygroundToken((socket.handshake.auth as { token?: unknown } | undefined)?.token, secret, Date.now());
    if (!claims) return next(Object.assign(new Error('unauthorized'), { data: { code: 'unauthorized' } }));
    socket.data.claims = claims;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const player = playerFor(socket.data.claims, socket);
    admit(player);
    playerJoined(player);
    void inventoryOf(player);
    log.debug('joined', { participantId: player.id, conversationId: player.conversationId });
    const windows = new Map<string, Window>();

    socket.onAny((event: string, payload: unknown, maybeAck?: unknown) => {
      const ack = typeof maybeAck === 'function' ? (maybeAck as Ack) : noAck;
      if (!isCurrent(player)) return;
      if (!allow(windows, event, Date.now())) return ack({ error: 'rate-limited' });
      const msg = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
      if (event === 'renew') return run(event, () => renew(player, msg.token, secret));
      const handler = HANDLERS[event];
      if (handler) run(event, () => handler(player, msg, ack));
    });

    socket.on('disconnect', (reason) => {
      if (remove(player)) {
        playerLeft(player, Date.now());
        run('disconnect', () => buildingLeft(player));
      }
      log.debug('left', { participantId: player.id, reason });
    });
  });

  const timer = setInterval(() => sweep(Date.now()), SWEEP_MS);
  timer.unref();
  const game = setInterval(() => run('tick', () => {
    const now = Date.now();
    tickGame(now);
    tickVitals(now);
  }), GAME_TICK_MS);
  game.unref();
  let maintaining = false;
  const upkeep = setInterval(() => {
    if (maintaining) return;
    maintaining = true;
    void maintainGame(Date.now()).catch((err: unknown) => log.error('error saving worlds', err)).finally(() => { maintaining = false; });
  }, MAINTAIN_MS);
  upkeep.unref();
  return { io, stop: () => { clearInterval(timer); clearInterval(game); clearInterval(upkeep); } };
}

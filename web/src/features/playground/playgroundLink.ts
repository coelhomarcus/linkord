import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { InventoryOp } from '@game/inventory';
import type { ServerMessage } from '@/shared/types/protocol';

// The connection to the playground service (playground/ at the repo root), where
// the world, inventories and fighting are decided and skins are kept, apart
// from the app's own socket so either can restart
// without the other. The service knows nobody: the app hands this connection a
// short-lived pass (`playground-token` on the app's socket) naming who it is and
// which call it is in, it is shown when connecting and renewed while you play.
// When the app says no (the service is off, or you are no longer in that
// playground) the link stops; anything else that goes wrong is tried again.

/** what hurt someone when no player did: a landing, a drowning, an empty stomach */
export type HurtCause = 'fall' | 'drown' | 'starve';

/** what the service says about a call's fighting (playground/src/combat.ts) */
export type PlaygroundServerMessage =
  /** a hit: `health` is the target's after it; a fresh hit (`hurt`) knocks the target back by `push`
   * (and `extra` from a sprinting attacker). Without an attacker (null), the world dealt it, for `cause`
   * (a service from before falls, air and hunger always names an attacker). */
  | { t: 'playground-hit'; conversationId: string; attackerId: string | null; targetId: string; damage: number; health: number; crit: boolean; hurt: boolean; push?: [number, number]; extra?: [number, number, number]; cause?: HurtCause }
  | { t: 'playground-health'; conversationId: string; players: { id: string; health: number }[] }
  /** your food level and saturation (playground/src/game/vitals.ts), when they change; a service from
   * before hunger never sends it */
  | { t: 'playground-vitals'; conversationId: string; food: number; saturation: number }
  /** your experience points in that playground, after a kill or when you arrive */
  | { t: 'playground-xp'; conversationId: string; xp: number }
  /** blocks that changed: `[x, y, z, block]` each (worldState.ts reads the rest of these) */
  | { t: 'playground-blocks'; conversationId: string; changes: unknown }
  /** items that appeared or moved on the ground, and items gone (`by` whoever picked them up) */
  | { t: 'playground-items'; conversationId: string; add?: unknown; remove?: unknown; by?: unknown }
  /** a furnace placed, lit or gone out */
  | { t: 'playground-furnace'; conversationId: string; x: number; y: number; z: number; facing: number; lit: boolean }
  /** what some connections hold now */
  | { t: 'playground-held'; conversationId: string; players: unknown }
  /** the world's clock, in ticks (game/dayTime.ts), against the drift of this browser's own count */
  | { t: 'playground-time'; conversationId: string; clock: unknown }
  /** your inventory as the service keeps it, up to your request `ack` (inventory/inventory.ts) */
  | { t: 'playground-inv'; conversationId: string; ack: number; inventory: unknown; furnace?: unknown };

export type PlaygroundClientMessage =
  /** where your avatar stands (feet), and where its head faces; `first` asks for everyone's health. Since the
   * last report: the blocks sprinted and the jumps, for hunger; `fall`, how far it fell before landing here */
  | {
    t: 'playground-pos'; x: number; y: number; z: number; yaw: number; first?: boolean;
    sprinted?: number; jumps?: number; sprintJumps?: number; fall?: number;
  }
  /** a punch that landed on `targetId` (a connection id), from where you stood */
  | { t: 'playground-attack'; targetId: string; x: number; y: number; z: number; yaw: number; crit: boolean; sprint: boolean }
  | { t: 'playground-respawn' }
  /** you started eating what you hold */
  | { t: 'eat-start' }
  /** you held the button on it for 32 ticks: it is eaten */
  | { t: 'eat'; seq: number }
  /** you started digging that block */
  | { t: 'dig-start'; x: number; y: number; z: number }
  /** you finished digging it; `seq` numbers every request that may change your inventory */
  | { t: 'block-break'; seq: number; x: number; y: number; z: number }
  /** the held block, put there */
  /** `face`: the face of the block it was put against (0..5: +x, -x, +y, -y, +z, -z), for its state */
  | { t: 'block-place'; seq: number; x: number; y: number; z: number; face: number }
  /** a right click on a crafting table or a furnace */
  | { t: 'block-use'; seq: number; x: number; y: number; z: number }
  | { t: 'inv-op'; seq: number; op: InventoryOp };

export type PlaygroundTokenReply = Extract<ServerMessage, { t: 'playground-token' }>;

/** Questions the service answers: `skin-get {userId}` and `skin-set {skin}` (playground/src/skins.ts), both
 * answered with `{ skin }` (a base64 PNG, or null for the account's default); `world-get`
 * (playground/src/building.ts), answered with the world. */
export type PlaygroundRequest =
  | { event: 'skin-get'; payload: { userId: string } }
  | { event: 'skin-set'; payload: { skin: string | null } }
  | { event: 'world-get'; payload: Record<string, never> };

/** The service's refusal (`not-here`, `invalid`, `unavailable`, `rate-limited`), or no answer at all. */
export class PlaygroundRequestError extends Error {}

/** What the session needs of the link; tests stand in for it. */
export interface ServiceLink {
  start(): void;
  dispose(): void;
  /** false when not connected: the message is dropped and the caller tries again later */
  send(message: PlaygroundClientMessage): boolean;
  receiveToken(reply: PlaygroundTokenReply): void;
  /** Asks the service, waiting a few seconds for the link to connect; throws PlaygroundRequestError. */
  request(request: PlaygroundRequest): Promise<Record<string, unknown>>;
}

/** How the link is doing: on its way, connected, or failing to get there (it keeps trying). */
export type LinkStatus = 'connecting' | 'connected' | 'unreachable';

export interface ServiceLinkOptions {
  conversationId: string;
  /** asks the app for a pass; false when its socket is not connected */
  requestToken: () => boolean;
  onMessage: (message: PlaygroundServerMessage) => void;
  /** connected (again): whatever the service should hear first goes out now */
  onConnect: () => void;
  onStatus?: (status: LinkStatus) => void;
}

const SOCKET_PATH = '/playground/ws';
const SERVER_EVENTS = [
  'playground-hit', 'playground-health', 'playground-xp', 'playground-vitals',
  'playground-blocks', 'playground-items', 'playground-furnace', 'playground-held', 'playground-inv',
  'playground-time',
] as const;
// the app's pass lasts 90 s (server/src/modules/playground/playgroundAccess.ts): two chances to renew it
const RENEW_MS = 30_000;
const TOKEN_TIMEOUT_MS = 5000;
// a question asked before the link is up (the first skins, as you arrive) waits for it this long
const CONNECT_WAIT_MS = 10_000;
const ANSWER_TIMEOUT_MS = 5000;
/** a world nobody visited yet is generated first */
const WORLD_TIMEOUT_MS = 20_000;
const RETRY_MS = [1000, 2000, 5000, 10_000, 20_000];
/** this many failed tries in a row, and the link says it cannot get there */
const UNREACHABLE_AFTER = 2;

type Grant = { url: string; token: string } | 'refused' | 'unanswered';

export class PlaygroundLink implements ServiceLink {
  private readonly options: ServiceLinkOptions;
  private socket: Socket | null = null;
  private waiting: { promise: Promise<Grant>; resolve: (grant: Grant) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private stopped = false;
  private readonly connectWaiters = new Set<(socket: Socket | null) => void>();

  constructor(options: ServiceLinkOptions) {
    this.options = options;
  }

  start(): void {
    void this.connect();
  }

  dispose(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.settle('unanswered');
    this.closeSocket();
    for (const waiter of [...this.connectWaiters]) waiter(null);
  }

  send(message: PlaygroundClientMessage): boolean {
    if (!this.socket?.connected) return false;
    this.socket.emit(message.t, message);
    return true;
  }

  async request({ event, payload }: PlaygroundRequest): Promise<Record<string, unknown>> {
    const socket = await this.connectedSocket();
    let answer: unknown;
    try {
      answer = await socket.timeout(event === 'world-get' ? WORLD_TIMEOUT_MS : ANSWER_TIMEOUT_MS).emitWithAck(event, payload);
    } catch {
      throw new PlaygroundRequestError('unanswered');
    }
    if (!answer || typeof answer !== 'object') throw new PlaygroundRequestError('unanswered');
    if ('error' in answer) throw new PlaygroundRequestError(String(answer.error));
    return answer as Record<string, unknown>;
  }

  private connectedSocket(): Promise<Socket> {
    if (this.socket?.connected) return Promise.resolve(this.socket);
    if (this.stopped) return Promise.reject(new PlaygroundRequestError('unavailable'));
    return new Promise((resolve, reject) => {
      const waiter = (socket: Socket | null) => {
        clearTimeout(timer);
        this.connectWaiters.delete(waiter);
        if (socket) resolve(socket);
        else reject(new PlaygroundRequestError('unavailable'));
      };
      const timer = setTimeout(() => waiter(null), CONNECT_WAIT_MS);
      this.connectWaiters.add(waiter);
    });
  }

  receiveToken(reply: PlaygroundTokenReply): void {
    if (reply.conversationId !== this.options.conversationId) return;
    this.settle(reply.token && reply.url ? { url: reply.url, token: reply.token } : 'refused');
  }

  private settle(grant: Grant): void {
    const waiting = this.waiting;
    if (!waiting) return;
    this.waiting = null;
    clearTimeout(waiting.timer);
    waiting.resolve(grant);
  }

  /** One request at a time; an answer that never comes counts as unanswered. */
  private requestGrant(): Promise<Grant> {
    if (this.waiting) return this.waiting.promise;
    if (!this.options.requestToken()) return Promise.resolve('unanswered');
    let resolve!: (grant: Grant) => void;
    const promise = new Promise<Grant>((r) => { resolve = r; });
    this.waiting = { promise, resolve, timer: setTimeout(() => this.settle('unanswered'), TOKEN_TIMEOUT_MS) };
    return promise;
  }

  private async connect(): Promise<void> {
    const grant = await this.requestGrant();
    if (this.stopped) return;
    if (grant === 'refused') {
      this.dispose();
      return;
    }
    if (grant === 'unanswered') {
      this.retryLater();
      return;
    }
    this.openSocket(grant);
  }

  private openSocket({ url, token }: { url: string; token: string }): void {
    this.closeSocket();
    // websocket only: the service may live on another origin, and a websocket needs no CORS there.
    // forceNew: never share the app's own socket's manager, which reaches the same origin.
    const socket = io(new URL(url, location.href).origin, { path: SOCKET_PATH, transports: ['websocket'], auth: { token }, reconnection: false, forceNew: true });
    this.socket = socket;
    for (const event of SERVER_EVENTS) socket.on(event, (message: PlaygroundServerMessage) => this.options.onMessage(message));
    socket.on('connect', () => {
      this.attempts = 0;
      this.options.onStatus?.('connected');
      this.renewTimer = setInterval(() => void this.renew(), RENEW_MS);
      for (const waiter of [...this.connectWaiters]) waiter(socket);
      this.options.onConnect();
    });
    // a pass that ran out, a restart of the service, a lost network: a fresh pass and a new socket
    const lost = () => {
      if (this.socket !== socket) return;
      this.closeSocket();
      this.retryLater();
    };
    socket.on('disconnect', lost);
    socket.on('connect_error', lost);
  }

  private async renew(): Promise<void> {
    const grant = await this.requestGrant();
    if (this.stopped) return;
    if (grant === 'refused') this.dispose();
    else if (grant !== 'unanswered') this.socket?.emit('renew', { token: grant.token });
  }

  private retryLater(): void {
    if (this.stopped || this.retryTimer) return;
    const base = RETRY_MS[Math.min(this.attempts, RETRY_MS.length - 1)]!;
    this.attempts++;
    this.options.onStatus?.(this.attempts >= UNREACHABLE_AFTER ? 'unreachable' : 'connecting');
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, base * (0.8 + Math.random() * 0.4));
  }

  private closeSocket(): void {
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.removeAllListeners();
    socket.disconnect();
  }
}

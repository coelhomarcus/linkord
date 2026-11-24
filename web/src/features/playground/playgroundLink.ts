import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { ServerMessage } from '@/shared/types/protocol';

// The connection to the playground service (playground/ at the repo root), where
// fighting is decided and skins are kept, apart from the app's own socket so either can restart
// without the other. The service knows nobody: the app hands this connection a
// short-lived pass (`playground-token` on the app's socket) naming who it is and
// which call it is in, it is shown when connecting and renewed while you play.
// When the app says no (the service is off, or you are no longer in that
// playground) the link stops; anything else that goes wrong is tried again.

/** what the service says about a call's fighting (playground/src/combat.ts) */
export type PlaygroundServerMessage =
  /** a hit: `health` is the target's after it; a fresh hit (`hurt`) knocks the target back by `push`
   * (and `extra` from a sprinting attacker) */
  | { t: 'playground-hit'; conversationId: string; attackerId: string; targetId: string; damage: number; health: number; crit: boolean; hurt: boolean; push?: [number, number]; extra?: [number, number, number] }
  | { t: 'playground-health'; conversationId: string; players: { id: string; health: number }[] }
  /** your experience points in that playground, after a kill or when you arrive */
  | { t: 'playground-xp'; conversationId: string; xp: number };

export type PlaygroundClientMessage =
  /** where your avatar stands (feet), and where its head faces; `first` asks for everyone's health */
  | { t: 'playground-pos'; x: number; y: number; z: number; yaw: number; first?: boolean }
  /** a punch that landed on `targetId` (a connection id), from where you stood */
  | { t: 'playground-attack'; targetId: string; x: number; y: number; z: number; yaw: number; crit: boolean; sprint: boolean }
  | { t: 'playground-respawn' };

export type PlaygroundTokenReply = Extract<ServerMessage, { t: 'playground-token' }>;

/** Questions the service answers (playground/src/skins.ts): `skin-get {userId}` and `skin-set {skin}`,
 * both answered with `{ skin }` (a base64 PNG, or null for the account's default). */
export type PlaygroundRequest = { event: 'skin-get'; payload: { userId: string } } | { event: 'skin-set'; payload: { skin: string | null } };

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
  request(request: PlaygroundRequest): Promise<{ skin?: unknown }>;
}

export interface ServiceLinkOptions {
  conversationId: string;
  /** asks the app for a pass; false when its socket is not connected */
  requestToken: () => boolean;
  onMessage: (message: PlaygroundServerMessage) => void;
  /** connected (again): whatever the service should hear first goes out now */
  onConnect: () => void;
}

const SOCKET_PATH = '/playground/ws';
const SERVER_EVENTS = ['playground-hit', 'playground-health', 'playground-xp'] as const;
// the app's pass lasts 90 s (server/src/modules/playground/playgroundAccess.ts): two chances to renew it
const RENEW_MS = 30_000;
const TOKEN_TIMEOUT_MS = 5000;
// a question asked before the link is up (the first skins, as you arrive) waits for it this long
const CONNECT_WAIT_MS = 10_000;
const ANSWER_TIMEOUT_MS = 5000;
const RETRY_MS = [1000, 2000, 5000, 10_000, 20_000];

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

  async request({ event, payload }: PlaygroundRequest): Promise<{ skin?: unknown }> {
    const socket = await this.connectedSocket();
    let answer: unknown;
    try {
      answer = await socket.timeout(ANSWER_TIMEOUT_MS).emitWithAck(event, payload);
    } catch {
      throw new PlaygroundRequestError('unanswered');
    }
    if (!answer || typeof answer !== 'object') throw new PlaygroundRequestError('unanswered');
    if ('error' in answer) throw new PlaygroundRequestError(String(answer.error));
    return answer;
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

import type { Socket } from 'socket.io';

import type { Locale } from './modules/users/locale.js';

export type Role = 'user' | 'admin';

/** Resolved session (see modules/auth/session.ts#resolveSession) —
 * attached as socket.user at handshake, used by every authenticated HTTP
 * route. */
export interface SessionUser {
  tokenHash: string;
  /** the session's public id (sessions.id), what the account's session list refers to */
  sessionId: string;
  userId: string;
  username: string;
  email: string | null;
  // free-form, non-unique — always resolved to a non-empty value here (see
  // auth/session.ts), falling back to `username` when the account never set one.
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  profileLinks: string[];
  role: Role;
  locale: Locale;
}

/** The single room's participant (see realtime/participants.ts). `id` is
 * per-CONNECTION (not per-account) — see the note in participants.ts.
 * `socket` is null during the reconnect grace window. */
export interface Participant {
  id: string;
  token: string;
  userId: string;
  socket: AppSocket | null;
  name: string;
  // editable, non-unique — what's shown everywhere in the UI instead of
  // `name`. Always non-empty (falls back to `name` — the username — server-side).
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  profileLinks: string[];
  role: Role;
  deafened: boolean;
  // Which call (voice channel or DM) they're in now, or null — set explicitly by
  // call join/leave (see realtime/socket.ts), never just from having the
  // socket connected.
  callConversationId: string | null;
  // self-reported by the client (see realtime/participants.ts handlers for
  // 'mic-state'/'camera'/'screen-share'/'speaking') — the server never
  // verifies these against LiveKit itself, same trust model as `deafened`.
  // Reset on every call join/leave, and ignored while there is no call, so
  // a muted camera (still published) reported as off cannot be revived by
  // a late message.
  micActivated: boolean;
  micMuted: boolean;
  // true from a call join until the client reports its mic settled (published, refused, missing):
  // with nothing published yet the mic would otherwise read as muted for that whole wait
  micStarting: boolean;
  // only clients from protocol 18 clear micStarting, so an older tab never starts in that state
  reportsMicStarting: boolean;
  // only clients from protocol 20 understand a `call-elsewhere` refusal; an older tab gets `call-not-allowed`
  knowsCallElsewhere: boolean;
  cameraOn: boolean;
  sharing: boolean;
  speaking: boolean;
  // reported by this connection's client after a stretch without input (see 'presence-activity');
  // an account set to "online" reads as idle only while all its live connections are idle
  idle: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
  // Friends ∪ members of every conversation this account is in — computed
  // ONCE per connection (handleJoin, realtime/socket.ts), not on every
  // presence event (mic/speaking toggles fire too often for a DB round trip
  // each time). Used to scope presence broadcasts (broadcastToKnownPeers)
  // so an unrelated account never sees this connection's mic/camera/
  // online state. Deliberately stale until the next reconnect — a brand
  // new friend's live presence only starts showing up after either side
  // reconnects, not immediately.
  knownPeerIds: Set<string>;
  // A known id alone does not grant access to a direct conversation.
  friendPeerIds: Set<string>;
  // Reactions are not shared between blocked accounts.
  blockedPeerIds: Set<string>;
}

/** Public shape of a Participant — what goes to the client (never `token`). */
export interface PublicParticipant {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  profileLinks: string[];
  role: Role;
  deafened: boolean;
  callConversationId: string | null;
  micActivated: boolean;
  micMuted: boolean;
  micStarting: boolean;
  cameraOn: boolean;
  sharing: boolean;
  speaking: boolean;
}

/** The socket.io `Socket` with fields realtime/socket.ts attaches
 * dynamically on connection: `participantId` (set by join()), `ip`
 * (computed once on connect), and `user` (the session resolved in io.use()
 * before 'connection' fires — no socket exists without it). */
export type AppSocket = Socket & {
  participantId: string | null;
  ip: string;
  user: SessionUser;
};

/** Socket.IO message handler signature — each feature exports a
 * `handlers: HandlerTable` (see realtime/socket.ts, combined via
 * Object.assign). `T` is left loose (`any` in the combined table) on
 * purpose: each concrete handler uses its real payload type, and `any` on
 * the target parameter lets TypeScript accept that without bypassing the
 * type check INSIDE each handler. */
type SocketHandler<T = unknown> = (socket: AppSocket, msg: T) => unknown | Promise<unknown>;
export type HandlerTable = Record<string, SocketHandler<any>>;

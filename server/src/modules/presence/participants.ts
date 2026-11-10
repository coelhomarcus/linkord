import crypto from 'node:crypto';
import type { ErrorCode } from '../../http/errors.js';
import { config } from '../../config/env.js';
import { resolveClientIp } from '../../http/clientInfo.js';
import { updateProfile } from '../profile/profileRepository.js';
import { isUploadedImage, sanitizeAvatar, sanitizeBanner, sanitizeAvatarColor, sanitizeDisplayName, sanitizeBio, sanitizeProfileLinks } from '../profile/sanitize.js';
import { deleteAvatarFile, isOwnedProfileImage } from '../attachments/attachmentCleanup.js';
import { recordUserLastSeen } from '../users/users.js';
import { runSerialized } from './profileQueue.js';
import { effectiveStatus, getAccountStatus, isInvisible, type CustomStatus, type PresenceStatus, type VisibleStatus } from './userStatus.js';
import type { AppSocket, HandlerTable, Participant, PublicParticipant, SessionUser } from '../../types.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'presence' });

// Presence for the single shared room. `id` is per-CONNECTION (used as the
// LiveKit identity) — if it were per-account, a second tab would get the
// same identity and LiveKit would kick the first one. `userId` (the
// account) is what ties reconnection together and lets two tabs coexist.
export const participants = new Map<string, Participant>(); // id -> participant

const newId = () => crypto.randomBytes(8).toString('hex');
const newToken = () => crypto.randomBytes(24).toString('hex');

/** What a participant needs from an account — a login session at join time, a
 * database row when a restart rebuilds one. */
type ParticipantProfile = Pick<SessionUser,
  'userId' | 'username' | 'displayName' | 'avatar' | 'avatarPoster' | 'avatarColor' | 'banner' | 'bannerPoster' | 'bio' | 'profileLinks' | 'role'>;

export interface RestorableCallParticipant {
  id: string;
  token: string;
  conversationId: string;
  deafened: boolean;
  profile: ParticipantProfile;
}

/** Where call membership outlives the process. Injected (like the removal hook
 * below) so this module stays free of the database. */
export interface CallPresenceStore {
  save(p: Participant): Promise<void>;
  remove(participantId: string): Promise<void>;
}

// Ghosts rebuilt after a restart. A fresh join of the same account (another tab
// that also lost its identity) must not evict them: their own client is still
// on its way back.
const restoredGhostIds = new Set<string>();

let callPresenceStore: CallPresenceStore | null = null;
export function setCallPresenceStore(store: CallPresenceStore | null): void {
  callPresenceStore = store;
}

// Per connection, in order: a join followed at once by a leave must not end
// with the join's row written last.
function persistCallPresence(p: Participant): void {
  const store = callPresenceStore;
  if (!store) return;
  void runSerialized(`call-presence:${p.id}`, () => store.save(p))
    .catch((err) => log.error('failed to persist call membership', err, { participantId: p.id }));
}

function forgetCallPresence(participantId: string): void {
  const store = callPresenceStore;
  if (!store) return;
  void runSerialized(`call-presence:${participantId}`, () => store.remove(participantId))
    .catch((err) => log.error('failed to forget call membership', err, { participantId }));
}

function createParticipant(u: ParticipantProfile, id: string, token: string, socket: AppSocket | null): Participant {
  return {
    id,
    token,
    userId: u.userId,
    socket,
    name: u.username,
    // u.displayName (SessionUser) already resolved a non-empty value in
    // session.ts — sanitizeDisplayName here is just defense in depth
    // (same pattern as sanitizeAvatar/sanitizeAvatarColor above).
    displayName: sanitizeDisplayName(u.displayName) || u.username,
    avatar: sanitizeAvatar(u.avatar),
    avatarPoster: sanitizeAvatar(u.avatarPoster),
    avatarColor: sanitizeAvatarColor(u.avatarColor),
    banner: sanitizeBanner(u.banner),
    bannerPoster: sanitizeBanner(u.bannerPoster),
    bio: sanitizeBio(u.bio),
    profileLinks: sanitizeProfileLinks(u.profileLinks),
    role: u.role,
    // always starts undeafened on a brand NEW connection (client starts
    // the same way); a resume reuses the existing participant and
    // PRESERVES the value.
    deafened: false,
    callConversationId: null,
    micActivated: false,
    micMuted: true,
    cameraOn: false,
    sharing: false,
    speaking: false,
    idle: false,
    graceTimer: null,
    knownPeerIds: new Set(),
    friendPeerIds: new Set(),
    blockedPeerIds: new Set(),
  };
}

/** Rebuilds, after a restart, the connections that were in a call — as if
 * their sockets had just dropped. Each waits out `graceMs` for its client to
 * resume with the saved id and token, and is removed (leaving the call, for
 * everyone else) if that never happens. The id is also the LiveKit identity,
 * so a client that resumes stays matched to its own media. */
export function restoreCallParticipants(entries: RestorableCallParticipant[], graceMs: number): number {
  let restored = 0;
  for (const entry of entries) {
    if (participants.has(entry.id)) continue;
    const p = createParticipant(entry.profile, entry.id, entry.token, null);
    p.callConversationId = entry.conversationId;
    p.deafened = entry.deafened;
    p.graceTimer = setTimeout(() => removeParticipant(p), graceMs);
    p.graceTimer.unref();
    participants.set(p.id, p);
    restoredGhostIds.add(p.id);
    restored++;
  }
  return restored;
}

export function publicParticipant(p: Participant): PublicParticipant {
  return {
    id: p.id, userId: p.userId, name: p.name, displayName: p.displayName,
    avatar: p.avatar, avatarPoster: p.avatarPoster, avatarColor: p.avatarColor,
    banner: p.banner, bannerPoster: p.bannerPoster, bio: p.bio, profileLinks: p.profileLinks, role: p.role,
    deafened: p.deafened, callConversationId: p.callConversationId,
    micActivated: p.micActivated, micMuted: p.micMuted, cameraOn: p.cameraOn, sharing: p.sharing, speaking: p.speaking,
  };
}

/** Changes which conversation's call `p` is in (or none, with null) and
 * notifies everyone. Also resets self-reported media flags: a fresh join/leave
 * means previous call state no longer applies. */
export function setCallConversationId(p: Participant, conversationId: string | null): void {
  const wasHidden = hiddenFromPeers(p);
  p.callConversationId = conversationId;
  p.micActivated = false;
  p.micMuted = true;
  p.cameraOn = false;
  p.sharing = false;
  p.speaking = false;
  persistCallPresence(p);
  const hidden = hiddenFromPeers(p);
  if (wasHidden === hidden) {
    broadcastParticipantUpdate(p);
    return;
  }
  // an invisible account shows up in the call it joins (and only there), so peers learn about this
  // connection now, and forget it again when it leaves; its own tabs always knew it
  sendToUser(p.userId, { t: 'participant-updated', participant: publicParticipant(p) });
  broadcastToPeers(p.userId, hidden ? { t: 'participant-left', id: p.id } : { t: 'participant-joined', participant: publicParticipant(p) });
}

/** An invisible account's connection outside any call: nobody but the account itself hears about it.
 * Inside a call it stays visible to everyone who can see that call (the product decision is in the
 * README), the same way the tiles and LiveKit media already show it. */
export function hiddenFromPeers(p: Participant): boolean {
  return isInvisible(p.userId) && !p.callConversationId;
}

/** `participant-updated` for one connection, kept to the account's own tabs while it is hidden. */
function broadcastParticipantUpdate(p: Participant): void {
  const msg = { t: 'participant-updated', participant: publicParticipant(p) };
  if (hiddenFromPeers(p)) sendToUser(p.userId, msg);
  else broadcastToKnownPeers(p.userId, msg);
}

/** `participant-joined` for a new or resumed connection, to everyone but itself. */
export function announceParticipantJoined(p: Participant): void {
  const msg = { t: 'participant-joined', participant: publicParticipant(p) };
  if (!hiddenFromPeers(p)) {
    broadcastToKnownPeers(p.userId, msg, p.id);
    return;
  }
  for (const other of participants.values()) {
    if (other.userId === p.userId && other.id !== p.id) send(other.socket, msg);
  }
}

/** Address of who connected — used for logging only. */
export function ipOf(socket: AppSocket): string {
  return resolveClientIp(config.TRUST_PROXY, socket.handshake.headers['x-forwarded-for'], socket.handshake.address, config.TRUSTED_PROXY_HOPS);
}

export function send(socket: AppSocket | null | undefined, obj: { t: string; [key: string]: unknown }): void {
  if (socket && socket.connected) {
    try { socket.emit(obj.t, obj); } catch { /* socket dying */ }
  }
}

/** The one way to put an `error` message on a socket, so its code is always a registered one. */
export function sendSocketError(socket: AppSocket | null | undefined, code: ErrorCode, message: string): void {
  send(socket, { t: 'error', code, message });
}

export function broadcast(obj: { t: string; [key: string]: unknown }, exceptId?: string): void {
  for (const p of participants.values()) {
    if (p.id === exceptId) continue;
    if (p.socket && p.socket.connected) { try { p.socket.emit(obj.t, obj); } catch { /* socket dying */ } }
  }
}

/** Deliver to peers recorded at socket join and the subject's other tabs.
 * Using each receiver's cached peers also handles subjects with no live connection. */
export function broadcastToKnownPeers(subjectUserId: string, obj: { t: string; [key: string]: unknown }, exceptId?: string): void {
  for (const p of participants.values()) {
    if (p.id === exceptId) continue;
    if (p.userId !== subjectUserId && (!p.knownPeerIds.has(subjectUserId) || p.blockedPeerIds.has(subjectUserId))) continue;
    if (p.socket && p.socket.connected) { try { p.socket.emit(obj.t, obj); } catch { /* socket dying */ } }
  }
}

/** Like broadcastToKnownPeers, minus the subject's own tabs: for what only other people need to hear
 * (the account turning invisible does not make it offline to itself). */
export function broadcastToPeers(subjectUserId: string, obj: { t: string; [key: string]: unknown }): void {
  for (const p of participants.values()) {
    if (p.userId === subjectUserId || !p.knownPeerIds.has(subjectUserId) || p.blockedPeerIds.has(subjectUserId)) continue;
    send(p.socket, obj);
  }
}

/** Sends `obj` to every live connection of one account (multi-tab/device
 * fan-out for events only that account should see). */
export function sendToUser(userId: string, obj: { t: string; [key: string]: unknown }): void {
  for (const p of participants.values()) {
    if (p.userId === userId) send(p.socket, obj);
  }
}

/** True if ANY connection for this account has a live socket right now —
 * used for the online/offline directory. Linear scan is fine at this scale. */
export function isUserOnline(userId: string): boolean {
  for (const p of participants.values()) {
    if (p.userId === userId && p.socket) return true;
  }
  return false;
}

/** Snapshot for `welcome` — distinct userIds with a live socket right now
 * (excludes anyone only in the grace window, see isUserOnline). */
export function listOnlineUserIds(): string[] {
  const ids = new Set<string>();
  for (const p of participants.values()) if (p.socket) ids.add(p.userId);
  return [...ids];
}

/** Online as other people see it: connected and not invisible. */
export function isUserVisiblyOnline(userId: string): boolean {
  return !isInvisible(userId) && isUserOnline(userId);
}

/** listOnlineUserIds without invisible accounts — everything a person can see goes through this one;
 * the raw list is for administration only. */
export function listVisibleOnlineUserIds(): string[] {
  return listOnlineUserIds().filter((userId) => !isInvisible(userId));
}

function everyConnectionIdle(userId: string): boolean {
  let live = 0;
  for (const p of participants.values()) {
    if (p.userId !== userId || !p.socket) continue;
    if (!p.idle) return false;
    live++;
  }
  return live > 0;
}

/** The account's status as its owner sees it: the chosen one, with automatic idle applied. */
export function ownEffectiveStatus(userId: string): PresenceStatus {
  return effectiveStatus(getAccountStatus(userId).status, everyConnectionIdle(userId));
}

export interface VisiblePresence {
  status: VisibleStatus;
  customStatus: CustomStatus | null;
}

/** What other people see of an account right now, or null while it reads as offline to them
 * (no live connection, or invisible). A custom status shows only alongside a visible status. */
export function visiblePresenceOf(userId: string): VisiblePresence | null {
  if (!isUserVisiblyOnline(userId)) return null;
  return { status: ownEffectiveStatus(userId) as VisibleStatus, customStatus: getAccountStatus(userId).customStatus };
}

/** The call module hears about a connection that is actually gone, not one sitting in the reconnect grace window. */
let onParticipantRemoved: ((p: Participant) => void) | null = null;
export function setParticipantRemovedHook(fn: (p: Participant) => void): void {
  onParticipantRemoved = fn;
}

export function removeParticipant(p: Participant): void {
  if (participants.get(p.id) !== p) return; // already replaced by a reconnect
  if (p.graceTimer) clearTimeout(p.graceTimer);
  const wasHidden = hiddenFromPeers(p);
  participants.delete(p.id);
  restoredGhostIds.delete(p.id);
  forgetCallPresence(p.id);
  onParticipantRemoved?.(p);
  if (wasHidden) sendToUser(p.userId, { t: 'participant-left', id: p.id });
  else broadcastToKnownPeers(p.userId, { t: 'participant-left', id: p.id });
  // only here (not handleClose) to respect the same grace window as
  // 'participant-left' — a brief network drop shouldn't flicker offline.
  // An invisible account already reads as offline, and recording when it really left would tell
  // its peers exactly what invisibility hides.
  if (!isUserOnline(p.userId) && !isInvisible(p.userId)) {
    const lastSeenAt = new Date();
    void recordUserLastSeen(p.userId, lastSeenAt).catch((err) => {
      log.error('failed to persist lastSeenAt', err, { userId: p.userId });
    });
    broadcastToKnownPeers(p.userId, { t: 'user-offline', userId: p.userId, lastSeenAt: lastSeenAt.toISOString() });
  }
  onAccountConnectionsChanged?.(p.userId);
}

/** presenceStatus.ts hears when an account loses a connection: its automatic idle may change, and an
 * account with no connection left drops its in-memory status. */
let onAccountConnectionsChanged: ((userId: string) => void) | null = null;
export function setAccountConnectionsChangedHook(fn: ((userId: string) => void) | null): void {
  onAccountConnectionsChanged = fn;
}

function countConnectionsOf(userId: string): number {
  let n = 0;
  for (const p of participants.values()) if (p.userId === userId && p.socket) n++;
  return n;
}

/** Removes ghosts (socket=null, stuck in the reconnect grace window) for
 * the SAME account before creating a new connection — otherwise a crashed
 * tab would hold the slot for the whole reconnect grace. */
function evictGhostsForUser(userId: string): void {
  for (const p of [...participants.values()]) {
    if (p.userId === userId && p.socket === null && !restoredGhostIds.has(p.id)) removeParticipant(p);
  }
}

interface JoinMessage {
  id?: string;
  token?: string;
}

/** Creates or resumes the connection's participant (same identity if a
 * valid resume token for the SAME account) and sets socket.participantId.
 * The `welcome` message itself is assembled by realtime/socket.ts (which
 * also touches chat/other features) to avoid a cycle. Sends the room-full
 * error and returns null when applicable. */
export function join(socket: AppSocket, msg: JoinMessage): { participant: Participant; justCameOnline: boolean } | null {
  if (socket.participantId) return null;
  const u = socket.user; // guaranteed by io.use — no socket exists without a valid session
  // computed BEFORE touching the Map — if this is the account's only
  // connection, it's a transition to "online" the directory needs to know.
  const wasOnline = isUserOnline(u.userId);
  let p: Participant | null = null;
  if (msg.id && msg.token) {
    const existing = participants.get(String(msg.id));
    // checking userId (not just the token) stops a resume token from being
    // reused by a different account.
    if (existing && existing.token === String(msg.token) && existing.userId === u.userId) p = existing;
  }
  if (p) {
    if (p.socket && p.socket !== socket) { try { p.socket.disconnect(true); } catch { /* ja desconectado */ } }
    if (p.graceTimer) clearTimeout(p.graceTimer);
    p.graceTimer = null;
    p.socket = socket;
    restoredGhostIds.delete(p.id);
  } else {
    if (participants.size >= config.MAX_PARTICIPANTS) {
      log.warn('join refused: room is full', { participants: participants.size, max: config.MAX_PARTICIPANTS });
      sendSocketError(socket, 'full', 'Sala cheia, tente mais tarde.');
      return null;
    }
    evictGhostsForUser(u.userId);
    // one account can't hold more than a handful of live connections (tabs,
    // devices) — otherwise a single sign-up could fill the whole room
    if (countConnectionsOf(u.userId) >= config.MAX_CONNECTIONS_PER_USER) {
      log.warn('join refused: too many connections', { userId: u.userId });
      sendSocketError(socket, 'too_many_connections', 'Você já tem conexões demais abertas. Feche alguma aba.');
      return null;
    }
    p = createParticipant({
      userId: u.userId, username: u.username, displayName: u.displayName, avatar: u.avatar, avatarPoster: u.avatarPoster,
      avatarColor: u.avatarColor, banner: u.banner, bannerPoster: u.bannerPoster, bio: u.bio, profileLinks: u.profileLinks, role: u.role,
    }, newId(), newToken(), socket);
    participants.set(p.id, p);
  }
  socket.participantId = p.id;
  // caller (handleJoin, realtime/socket.ts) computes p.knownPeerIds and
  // broadcasts 'user-online' itself — that field doesn't exist yet here.
  return { participant: p, justCameOnline: !wasOnline };
}

/** Avatar, avatar background color, and displayName are all editable —
 * `name` stays the account's immutable username (used for @mentions/login,
 * never shown as-is once displayName exists). An empty/whitespace-only
 * displayName resets back to the username, same idea as avatarColor
 * falling back to the default on an invalid value. Persisted to survive
 * reconnects/other tabs. */
interface ProfilePatchBody {
  requestId?: unknown;
  avatar?: string; avatarPoster?: string; avatarColor?: string; displayName?: string;
  banner?: string; bannerPoster?: string; bio?: string; profileLinks?: string[];
}

/** What an image field becomes after a patch. sanitizeAvatar/sanitizeBanner
 * only check the STRING's format; a NEW value must also be a `/uploads/<id>`
 * this account uploaded. Resending the current value keeps it — a profile set
 * to an external URL before that option was removed isn't wiped by saving the
 * display name — and '' still removes it. A new external URL leaves the field
 * as it was, and someone else's upload empties it: the only way to send either
 * is a modified client, which deserves no more than "your avatar didn't change". */
async function acceptedImage(url: string, current: string, uploaderId: string): Promise<string> {
  if (!url || url === current) return url;
  if (!isUploadedImage(url)) return current;
  return await isOwnedProfileImage(url, uploaderId) ? url : '';
}

async function handleProfile(socket: AppSocket, msg: ProfilePatchBody | null | undefined): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const body = msg && typeof msg === 'object' ? msg : {};
  const requestId = typeof body.requestId === 'string' ? body.requestId : null;

  const fail = (code: string, message: string) => {
    if (requestId) send(socket, { t: 'profile-result', requestId, ok: false, code, message });
  };

  // Serialized per account: two tabs patching close together must apply in
  // order against a consistent base, not both read the same stale `p.*` and
  // race to persist last (see profileQueue.ts).
  await runSerialized(p.userId, async () => {
    // re-read after the lock: a same-account tab ahead of us in the queue may
    // have just changed `p.*`, and a disconnect/account deletion while queued
    // means there's nothing left to patch
    const current = participants.get(socket.participantId ?? '');
    if (!current || current.socket !== socket) return;

    const oldAvatar = current.avatar;
    const oldAvatarPoster = current.avatarPoster;
    const nextAvatar = Object.prototype.hasOwnProperty.call(body, 'avatar')
      ? await acceptedImage(sanitizeAvatar(body.avatar), current.avatar, current.userId)
      : current.avatar;
    const nextAvatarPoster = Object.prototype.hasOwnProperty.call(body, 'avatarPoster')
      ? await acceptedImage(sanitizeAvatar(body.avatarPoster), current.avatarPoster, current.userId)
      : current.avatarPoster;
    const nextAvatarColor = Object.prototype.hasOwnProperty.call(body, 'avatarColor')
      ? sanitizeAvatarColor(body.avatarColor)
      : current.avatarColor;
    const nextDisplayName = Object.prototype.hasOwnProperty.call(body, 'displayName')
      ? (sanitizeDisplayName(body.displayName) || current.name)
      : current.displayName;
    const nextBanner = Object.prototype.hasOwnProperty.call(body, 'banner')
      ? await acceptedImage(sanitizeBanner(body.banner), current.banner, current.userId)
      : current.banner;
    const nextBannerPoster = Object.prototype.hasOwnProperty.call(body, 'bannerPoster')
      ? await acceptedImage(sanitizeBanner(body.bannerPoster), current.bannerPoster, current.userId)
      : current.bannerPoster;
    const nextBio = Object.prototype.hasOwnProperty.call(body, 'bio')
      ? sanitizeBio(body.bio)
      : current.bio;
    let nextProfileLinks = current.profileLinks;

    const nextProfile = {
      avatar: nextAvatar, avatarPoster: nextAvatarPoster, avatarColor: nextAvatarColor, displayName: nextDisplayName,
      banner: nextBanner, bannerPoster: nextBannerPoster, bio: nextBio, profileLinks: nextProfileLinks,
    };

    // persisted BEFORE anything else sees it: a DB failure must not broadcast
    // an unconfirmed profile, delete the old photo, or tell the sender "ok"
    let saved;
    try {
      saved = await updateProfile(current.userId, nextProfile);
    } catch (err) {
      log.error('failed to save profile', err, { participantId: current.id });
      fail('internal_error', 'Não foi possível salvar o perfil agora. Tente de novo.');
      return;
    }
    if (!saved) {
      // the account row is gone (deleted mid-session) — nothing to confirm
      fail('not_found', 'Sua conta não foi encontrada.');
      return;
    }

    nextProfileLinks = saved.profileLinks;
    nextProfile.profileLinks = nextProfileLinks;
    for (const other of participants.values()) {
      if (other.userId !== current.userId) continue;
      other.avatar = nextAvatar;
      other.avatarPoster = nextAvatarPoster;
      other.avatarColor = nextAvatarColor;
      other.displayName = nextDisplayName;
      other.banner = nextBanner;
      other.bannerPoster = nextBannerPoster;
      other.bio = nextBio;
      other.profileLinks = nextProfileLinks;
      broadcastParticipantUpdate(other);
    }
    if (requestId) send(socket, { t: 'profile-result', requestId, ok: true, ...nextProfile });
    // deletes the OLD photo file(s) if they were one of our uploads and
    // changed — otherwise each photo change would leave the previous one(s)
    // orphaned. Only reachable once the new ones are confirmed persisted.
    if (oldAvatar && oldAvatar !== nextAvatar) {
      deleteAvatarFile(oldAvatar).catch((err) => log.error('failed to delete old profile photo', err, { participantId: current.id }));
    }
    if (oldAvatarPoster && oldAvatarPoster !== nextAvatarPoster) {
      deleteAvatarFile(oldAvatarPoster).catch((err) => log.error('failed to delete old profile photo', err, { participantId: current.id }));
    }
  });
}

/** Media flags describe the call the connection is in. A report with no
 * call (a late one, after call-leave) must not turn them back on. */
function participantInCall(socket: AppSocket): Participant | undefined {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !p.callConversationId) return undefined;
  return p;
}

/** No LiveKit track equivalent for "deafened" — just a flag the client
 * announces so others can show the icon. */
function handleDeafened(socket: AppSocket, msg: { value?: unknown }): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  p.deafened = !!msg.value;
  if (p.callConversationId) persistCallPresence(p);
  broadcastParticipantUpdate(p);
}

/** Self-reported mic state (see ClientMessage 'mic-state') — the server
 * never verifies this against LiveKit, same trust model as `deafened`.
 * Lets anyone see an accurate mic-muted icon for this participant, not
 * just people connected to the same LiveKit room. Ignored outside a call:
 * a report that arrives after call-leave must not light the icon again. */
function handleMicState(socket: AppSocket, msg: { activated?: unknown; muted?: unknown }): void {
  const p = participantInCall(socket);
  if (!p) return;
  p.micActivated = !!msg.activated;
  p.micMuted = !!msg.muted;
  broadcastParticipantUpdate(p);
}

function handleCamera(socket: AppSocket, msg: { on?: unknown }): void {
  const p = participantInCall(socket);
  if (!p) return;
  p.cameraOn = !!msg.on;
  broadcastParticipantUpdate(p);
}

function handleScreenShare(socket: AppSocket, msg: { on?: unknown }): void {
  const p = participantInCall(socket);
  if (!p) return;
  p.sharing = !!msg.on;
  broadcastParticipantUpdate(p);
}

/** Detected 100% client-side (real audio level via Web Audio, see
 * useLiveKitTrack.ts#useTrackSpeaking) — this just relays the already
 * debounced on/off transitions, not a continuous stream. */
function handleSpeaking(socket: AppSocket, msg: { value?: unknown }): void {
  const p = participantInCall(socket);
  if (!p) return;
  p.speaking = !!msg.value;
  broadcastParticipantUpdate(p);
}

// tab closing/reloading: leaves the room immediately, without the reconnect
// grace window (that's only for network drops/crashes, which never fire
// this event).
function handleLeave(socket: AppSocket): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  removeParticipant(p);
}

/** socket.on('disconnect') — opens the reconnect grace window instead of
 * removing immediately, covering network drops/reloads where 'leave' never
 * fires. */
export function handleClose(socket: AppSocket): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return; // already replaced by a newer reconnect
  p.socket = null;
  const graceMs = p.callConversationId ? config.CALL_RECONNECT_GRACE_MS : config.RECONNECT_GRACE_MS;
  p.graceTimer = setTimeout(() => removeParticipant(p), graceMs);
}

export const handlers: HandlerTable = {
  profile: handleProfile,
  deafened: handleDeafened,
  'mic-state': handleMicState,
  camera: handleCamera,
  'screen-share': handleScreenShare,
  speaking: handleSpeaking,
  leave: handleLeave,
};

export function publishProfileConnections(userId: string, profileLinks: string[]): void {
  for (const participant of participants.values()) {
    if (participant.userId === userId) participant.profileLinks = profileLinks;
  }
  broadcastToKnownPeers(userId, { t: 'profile-connections-changed', userId, profileLinks });
}

import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { recordUserLastSeen } from '../users/users.js';
import {
  participants, broadcastToPeers, sendToUser, send, publicParticipant, isUserOnline, ownEffectiveStatus,
  visiblePresenceOf, setAccountConnectionsChangedHook, type VisiblePresence,
} from './participants.js';
import { runSerialized } from './profileQueue.js';
import {
  forgetAccountStatus, getAccountStatus, hasAccountStatus, isCustomStatusExpired, isPresenceStatus, sameCustomStatus,
  sanitizeCustomStatus, setAccountStatus, type AccountStatus, type CustomStatus, type PresenceStatus,
} from './userStatus.js';
import type { AppSocket, HandlerTable } from '../../types.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'presence-status' });

// What peers and the account's own tabs were last told, so a change is announced once, and only when
// it is one: activity reports from several tabs mostly change nothing anyone can see.
const toPeers = new Map<string, VisiblePresence | null>();
interface OwnStatus { status: PresenceStatus; effective: PresenceStatus; customStatus: CustomStatus | null }
const toSelf = new Map<string, OwnStatus>();
const expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

// setTimeout takes a 32-bit delay; a longer expiry re-arms when this one fires
const MAX_TIMER_MS = 2 ** 31 - 1;

/** Where the status outlives the process and other devices. Injected so the presence tests run
 * without a database (the same idea as setCallPresenceStore). */
export interface AccountStatusStore {
  load(userId: string): Promise<AccountStatus | null>;
  save(userId: string, value: AccountStatus): Promise<void>;
}

export const databaseAccountStatusStore: AccountStatusStore = {
  async load(userId) {
    const [row] = await db.select({
      status: users.presenceStatus, emoji: users.customStatusEmoji, text: users.customStatusText, expiresAt: users.customStatusExpiresAt,
    }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row) return null;
    const customStatus = row.emoji || row.text
      ? { emoji: row.emoji, text: row.text, expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null }
      : null;
    return { status: isPresenceStatus(row.status) ? row.status : 'online', customStatus };
  },
  async save(userId, value) {
    await db.update(users).set({
      presenceStatus: value.status,
      customStatusEmoji: value.customStatus?.emoji ?? '',
      customStatusText: value.customStatus?.text ?? '',
      customStatusExpiresAt: value.customStatus?.expiresAt ? new Date(value.customStatus.expiresAt) : null,
      updatedAt: new Date(),
    }).where(eq(users.id, userId));
  },
};

let store: AccountStatusStore = databaseAccountStatusStore;
export function setAccountStatusStore(next: AccountStatusStore): void {
  store = next;
}

function ownStatusOf(userId: string): OwnStatus {
  const { status, customStatus } = getAccountStatus(userId);
  return { status, effective: ownEffectiveStatus(userId), customStatus };
}

/** The `my-status` message for an account's own tabs (also the `welcome`/`presence-sync` field). */
export function ownStatusPayload(userId: string): OwnStatus {
  return ownStatusOf(userId);
}

function samePresence(a: VisiblePresence | null, b: VisiblePresence | null): boolean {
  if (!a || !b) return a === b;
  return a.status === b.status && sameCustomStatus(a.customStatus, b.customStatus);
}

/** Tells peers and the account's own tabs about whatever changed since they were last told. Peers
 * hear `presence-status` only while the account is visibly online; going on- or offline itself
 * travels as `user-online`/`user-offline`, and a plain "online" with no custom status is what a
 * client assumes for anyone it just saw come online, so that case sends nothing. */
export function syncPresence(userId: string): void {
  const before = toPeers.get(userId) ?? null;
  const now = visiblePresenceOf(userId);
  toPeers.set(userId, now);
  if (now && !samePresence(before, now) && (before || now.status !== 'online' || now.customStatus)) {
    broadcastToPeers(userId, { t: 'presence-status', userId, status: now.status, customStatus: now.customStatus });
  }
  const own = ownStatusOf(userId);
  const told = toSelf.get(userId);
  if (!told || told.status !== own.status || told.effective !== own.effective || !sameCustomStatus(told.customStatus, own.customStatus)) {
    toSelf.set(userId, own);
    // a tab that joins gets this in its welcome; the message is for the tabs already open
    if (told) sendToUser(userId, { t: 'my-status', ...own });
  }
}

/** Reads the account's status into memory before its connection is announced. An account that
 * already has a connection keeps the copy in memory, which is the newer one. */
export async function loadAccountStatus(userId: string): Promise<void> {
  if (hasAccountStatus(userId)) return;
  let loaded: AccountStatus | null = null;
  try {
    loaded = await store.load(userId);
  } catch (err) {
    // the person still gets in, as "online"; their saved status applies on the next connection
    log.error('failed to load presence status', err, { userId });
  }
  if (!loaded || hasAccountStatus(userId)) return;
  const expired = isCustomStatusExpired(loaded.customStatus);
  const value = expired ? { ...loaded, customStatus: null } : loaded;
  setAccountStatus(userId, value);
  scheduleExpiry(userId);
  if (expired) void persist(userId, value);
}

async function persist(userId: string, value: AccountStatus): Promise<boolean> {
  try {
    await store.save(userId, value);
    return true;
  } catch (err) {
    log.error('failed to save presence status', err, { userId });
    return false;
  }
}

function scheduleExpiry(userId: string): void {
  const previous = expiryTimers.get(userId);
  if (previous) clearTimeout(previous);
  expiryTimers.delete(userId);
  const expiresAt = getAccountStatus(userId).customStatus?.expiresAt;
  if (!expiresAt) return;
  const timer = setTimeout(() => {
    expiryTimers.delete(userId);
    void runSerialized(`status:${userId}`, async () => {
      if (!hasAccountStatus(userId)) return;
      const current = getAccountStatus(userId);
      if (current.customStatus?.expiresAt !== expiresAt) return; // replaced meanwhile
      if (!isCustomStatusExpired(current.customStatus)) {
        scheduleExpiry(userId);
        return;
      }
      const next = { ...current, customStatus: null };
      applyAccountStatus(userId, next);
      await persist(userId, next);
    }).catch((err) => log.error('failed to expire custom status', err, { userId }));
  }, Math.max(0, Math.min(MAX_TIMER_MS, Date.parse(expiresAt) - Date.now())));
  timer.unref();
  expiryTimers.set(userId, timer);
}

/** Puts a new status in memory and tells everyone who should hear about it. Turning invisible looks,
 * to peers, exactly like the account going offline (its connections outside a call leave, then
 * `user-offline`); turning visible again looks like it coming back. */
function applyAccountStatus(userId: string, next: AccountStatus): void {
  const wasInvisible = getAccountStatus(userId).status === 'invisible';
  setAccountStatus(userId, next);
  scheduleExpiry(userId);
  const nowInvisible = next.status === 'invisible';
  const online = isUserOnline(userId);
  if (online && !wasInvisible && nowInvisible) {
    for (const p of participants.values()) {
      if (p.userId === userId && !p.callConversationId) broadcastToPeers(userId, { t: 'participant-left', id: p.id });
    }
    const lastSeenAt = new Date();
    void recordUserLastSeen(userId, lastSeenAt).catch((err) => log.error('failed to persist lastSeenAt', err, { userId }));
    broadcastToPeers(userId, { t: 'user-offline', userId, lastSeenAt: lastSeenAt.toISOString() });
  }
  if (online && wasInvisible && !nowInvisible) {
    for (const p of participants.values()) {
      if (p.userId === userId && !p.callConversationId) broadcastToPeers(userId, { t: 'participant-joined', participant: publicParticipant(p) });
    }
    // the status first, so nobody shows "online" for an instant before "do not disturb"
    syncPresence(userId);
    broadcastToPeers(userId, { t: 'user-online', userId });
    return;
  }
  syncPresence(userId);
}

interface PresenceSetBody { requestId?: unknown; status?: unknown; customStatus?: unknown }

/** `presence-set`: the status, the custom status, or both. Saved before anything is announced, so a
 * database failure leaves every device as it was (and the sender gets told). */
async function handlePresenceSet(socket: AppSocket, msg: PresenceSetBody | null | undefined): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const body = msg && typeof msg === 'object' ? msg : {};
  const requestId = typeof body.requestId === 'string' ? body.requestId.slice(0, 64) : null;
  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
  const hasCustom = Object.prototype.hasOwnProperty.call(body, 'customStatus');
  const reply = (ok: boolean) => { if (requestId) send(socket, { t: 'presence-result', requestId, ok }); };
  if ((hasStatus && !isPresenceStatus(body.status)) || (!hasStatus && !hasCustom)) {
    reply(false);
    return;
  }
  await runSerialized(`status:${p.userId}`, async () => {
    const current = getAccountStatus(p.userId);
    const next: AccountStatus = {
      status: hasStatus ? body.status as PresenceStatus : current.status,
      customStatus: hasCustom ? sanitizeCustomStatus(body.customStatus) : current.customStatus,
    };
    if (!(await persist(p.userId, next))) {
      reply(false);
      return;
    }
    applyAccountStatus(p.userId, next);
    reply(true);
  });
}

/** `presence-activity`: this connection's client noticed the person stopped (or started again)
 * using it. Only feeds automatic idle; nothing is stored. */
function handlePresenceActivity(socket: AppSocket, msg: { idle?: unknown } | null | undefined): void {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const idle = !!msg?.idle;
  if (p.idle === idle) return;
  p.idle = idle;
  syncPresence(p.userId);
}

/** Called when a connection goes away, and when a join that loaded the status was refused. */
export function releaseAccountStatusIfUnused(userId: string): void {
  onConnectionsChanged(userId);
}

function onConnectionsChanged(userId: string): void {
  for (const p of participants.values()) {
    if (p.userId === userId) {
      syncPresence(userId);
      return;
    }
  }
  // the account's last connection is gone: its next one reads the status back from the database
  const timer = expiryTimers.get(userId);
  if (timer) clearTimeout(timer);
  expiryTimers.delete(userId);
  forgetAccountStatus(userId);
  toPeers.delete(userId);
  toSelf.delete(userId);
}

setAccountConnectionsChangedHook(onConnectionsChanged);

export const handlers: HandlerTable = {
  'presence-set': handlePresenceSet,
  'presence-activity': handlePresenceActivity,
};

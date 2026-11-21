import { useSyncExternalStore } from 'react';
import { ApiError, apiFetch } from '@/shared/api/api';
import { LOCAL_STORAGE_KEYS, localStorageStore, type LocalStorageKey } from '@/shared/lib/localStorage';
import { logger } from '@/shared/lib/logger';
import { PREFERENCE_KINDS, PREFERENCE_PREFIXES, type PreferenceKind } from './preferenceKinds';

// The settings that follow the account to every device (server: modules/users/preferences.ts), as one
// flat map of key -> value holding only what differs from each feature's default. The feature modules
// (theme, clock, sounds, ...) own their keys' meaning and defaults and read and write through here.
//
// What the page shows is the last known map, cached in localStorage so the first paint, the sign-in
// screen and index.html's boot script (theme, density, font) are right before the server answers. A
// change applies at once and is sent after a short pause (a slider sends its last value only); one the
// server could not be reached for is sent again a little later and after the next `welcome`, one it
// refused is undone.

export type PreferenceValue = string | number | boolean | readonly string[];
export type Preferences = Readonly<Record<string, PreferenceValue>>;

const log = logger.child({ component: 'account-preferences' });

const SEND_DELAY_MS = 400;
const RETRY_DELAY_MS = 10_000;
const CACHE_KEY = LOCAL_STORAGE_KEYS.preferences;
const OWNER_KEY = LOCAL_STORAGE_KEYS.preferencesOwner;

/** Read by index.html before the bundle loads, so they are kept beside the cache. */
const BOOT_KEYS: Readonly<Record<string, LocalStorageKey>> = {
  colorTheme: LOCAL_STORAGE_KEYS.colorTheme,
  density: LOCAL_STORAGE_KEYS.density,
  font: LOCAL_STORAGE_KEYS.font,
};

const TOKEN = /^[a-z0-9-]{1,32}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SUFFIX: Readonly<Record<string, RegExp>> = {
  'callVolume:': /^[A-Za-z0-9_-]{1,64}(:screen)?$/,
  'collapsed:': ID,
};

function kindOf(key: string): PreferenceKind | null {
  if (Object.hasOwn(PREFERENCE_KINDS, key)) return PREFERENCE_KINDS[key as keyof typeof PREFERENCE_KINDS];
  for (const [prefix, kind] of Object.entries(PREFERENCE_PREFIXES)) {
    if (key.startsWith(prefix) && SUFFIX[prefix].test(key.slice(prefix.length))) return kind;
  }
  return null;
}

/** The server's own check (preferencesPolicy.ts): a value it would refuse is never sent. */
function isValidPreference(key: string, value: unknown): value is PreferenceValue {
  switch (kindOf(key)) {
    case 'token': return typeof value === 'string' && TOKEN.test(value);
    case 'boolean': return typeof value === 'boolean';
    case 'skinTone': return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 5;
    case 'volume': return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    case 'idList':
      return Array.isArray(value) && value.length > 0 && value.length <= 200 && value.every((id) => typeof id === 'string' && ID.test(id));
    default: return false;
  }
}

function clean(data: unknown): Preferences {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).filter(([key, value]) => isValidPreference(key, value)));
}

// --- the local cache -------------------------------------------------------------------------------

const LEGACY_FLAGS = {
  showStats: 'ss-show-stats', hideAudioOnlyTiles: 'ss-hide-audio-only-tiles', showTileBanners: 'ss-show-tile-banners',
  compressImages: 'ss-compress-images', mirrorCameraPreview: 'ss-mirror-camera-preview',
} as const;
const LEGACY_SOUNDS = 'ss-sounds';
const LEGACY_TIME_FORMAT = 'ss-time-format';
const LEGACY_SKIN_TONE = 'ss-emoji-skin-tone';
const LEGACY_CALL_VOLUMES = 'ss-call-volumes';
const LEGACY_COLLAPSED = 'ss-collapsed-categories:';

function parseJson(raw: string | null): unknown {
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** What builds before this one saved each setting under its own key, gathered once into the cache. The
 * old keys go away, except the ones index.html still reads. */
function takeLegacyPreferences(): Preferences {
  const found: Record<string, unknown> = {};
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();
  if (!storage) return {};
  const take = (key: string) => {
    try {
      const raw = storage.getItem(key);
      storage.removeItem(key);
      return raw;
    } catch {
      return null;
    }
  };
  for (const [key, storageKey] of Object.entries(BOOT_KEYS)) {
    const raw = localStorageStore.get(storageKey);
    if (raw !== null) found[key] = raw;
  }
  const timeFormat = take(LEGACY_TIME_FORMAT);
  if (timeFormat !== null) found.timeFormat = timeFormat;
  for (const [key, storageKey] of Object.entries(LEGACY_FLAGS)) {
    const raw = take(storageKey);
    if (raw === '1' || raw === '0') found[key] = raw === '1';
  }
  const sounds = parseJson(take(LEGACY_SOUNDS));
  if (sounds && typeof sounds === 'object') {
    for (const [group, on] of Object.entries(sounds)) found[`sounds.${group}`] = on;
  }
  const tone = take(LEGACY_SKIN_TONE);
  if (tone !== null) found.emojiSkinTone = Number(tone);
  const volumes = parseJson(take(LEGACY_CALL_VOLUMES));
  if (volumes && typeof volumes === 'object') {
    for (const [who, volume] of Object.entries(volumes)) found[`callVolume:${who}`] = volume;
  }
  try {
    const collapsedKeys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => !!key?.startsWith(LEGACY_COLLAPSED));
    for (const storageKey of collapsedKeys) found[`collapsed:${storageKey.slice(LEGACY_COLLAPSED.length)}`] = parseJson(take(storageKey));
  } catch {
    // storage refused to list its keys: those categories open again
  }
  return clean(found);
}

let snapshot: Preferences = {};
// the cache text `snapshot` was read from or written as; undefined until the first read
let snapshotRaw: string | null | undefined;
// storage refused a write: from then on this page keeps the map in memory only
let memoryOnly = false;

function writeCache(next: Preferences): void {
  snapshot = next;
  for (const [key, storageKey] of Object.entries(BOOT_KEYS)) {
    const value = next[key];
    if (typeof value === 'string') localStorageStore.set(storageKey, value);
    else localStorageStore.remove(storageKey);
  }
  if (memoryOnly) return;
  const raw = JSON.stringify(next);
  localStorageStore.set(CACHE_KEY, raw);
  if (localStorageStore.get(CACHE_KEY) === raw) snapshotRaw = raw;
  else memoryOnly = true;
}

/** The map as this page knows it. The same object comes back while nothing changed (useSyncExternalStore). */
export function getPreferences(): Preferences {
  if (memoryOnly) return snapshot;
  const raw = localStorageStore.get(CACHE_KEY);
  if (raw === snapshotRaw) return snapshot;
  if (raw === null) {
    writeCache(takeLegacyPreferences());
    return snapshot;
  }
  snapshotRaw = raw;
  snapshot = clean(parseJson(raw));
  return snapshot;
}

export function getPreference(key: string): PreferenceValue | undefined {
  const prefs = getPreferences();
  return Object.hasOwn(prefs, key) ? prefs[key] : undefined;
}

// --- readers ---------------------------------------------------------------------------------------

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

if (typeof window !== 'undefined') {
  // another tab of this browser wrote the cache
  window.addEventListener('storage', (event) => { if (event.key === CACHE_KEY || event.key === null) notify(); });
}

/** Re-renders when what `read` derives from the preferences changes. `read` must return the same value
 * (a primitive, or a cached object) while nothing it reads changed. */
export function usePreferenceValue<T>(read: () => T): T {
  return useSyncExternalStore(subscribePreferences, read);
}

// --- sync with the account -------------------------------------------------------------------------

/** The account this page synced with; null while signed out or before the server first answered. */
let accountId: string | null = null;
/** What the server holds, as last heard. */
let confirmed: Preferences = {};
/** Changes not sent yet; null clears a key. */
let pending = new Map<string, PreferenceValue | null>();
let inFlight: Map<string, PreferenceValue | null> | null = null;
let sendTimer: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<void> = Promise.resolve();

function withChanges(base: Preferences, ...changes: (ReadonlyMap<string, PreferenceValue | null> | null)[]): Preferences {
  const next: Record<string, PreferenceValue> = { ...base };
  for (const map of changes) {
    if (!map) continue;
    for (const [key, value] of map) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
  }
  return next;
}

function sameValue(a: PreferenceValue | undefined, b: PreferenceValue | undefined): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => v === b[i]);
  return a === b;
}

/** `confirmed` plus whatever this page changed and the server has not answered yet. */
function showConfirmed(): void {
  const next = withChanges(confirmed, inFlight, pending);
  const prev = getPreferences();
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const changed = [...keys].some((key) => !sameValue(prev[key], next[key]));
  if (!changed) return;
  writeCache(next);
  notify();
}

/** Sets one preference (null, or the feature's default, clears it) for this page now and the account soon. */
export function setPreference(key: string, value: PreferenceValue | null): void {
  if (value !== null && !isValidPreference(key, value)) {
    log.warn('preference refused before sending', { key });
    return;
  }
  const prefs = getPreferences();
  if (sameValue(prefs[key], value ?? undefined)) return;
  writeCache(withChanges(prefs, new Map([[key, value]])));
  notify();
  pending.set(key, value);
  scheduleSend(SEND_DELAY_MS);
}

function scheduleSend(delay: number): void {
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = setTimeout(() => { sendTimer = null; sendPending(); }, delay);
}

function sendPending(): void {
  if (!accountId || inFlight || pending.size === 0) return;
  const batch = pending;
  pending = new Map();
  inFlight = batch;
  const account = accountId;
  void apiFetch<{ preferences: Preferences }>('/api/me/preferences', {
    method: 'PATCH',
    body: JSON.stringify({ changes: Object.fromEntries(batch) }),
  }).then(({ preferences }) => {
    if (account !== accountId) return;
    inFlight = null;
    confirmed = clean(preferences);
    showConfirmed();
    sendPending();
  }, (err: unknown) => {
    if (account !== accountId) return;
    inFlight = null;
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      // refused: the account keeps what it had, and so does this page
      log.warn('preferences refused', { status: err.status, code: err.code });
      showConfirmed();
      return;
    }
    // unreachable: kept (behind anything changed since) and sent again later, or after the next welcome
    for (const [key, value] of batch) if (!pending.has(key)) pending.set(key, value);
    if (!sendTimer) scheduleSend(RETRY_DELAY_MS);
  });
}

async function seed(account: string): Promise<Preferences | null> {
  const owner = localStorageStore.get(OWNER_KEY);
  // a browser last used by another account starts this one at the defaults instead of handing it over
  const values = owner === null || owner === account ? getPreferences() : {};
  try {
    return clean((await apiFetch<{ preferences: Preferences }>('/api/me/preferences/seed', { method: 'POST', body: JSON.stringify({ values }) })).preferences);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 400) return null;
    log.warn('preferences seed refused', { code: err.code });
    try {
      return clean((await apiFetch<{ preferences: Preferences }>('/api/me/preferences/seed', { method: 'POST', body: JSON.stringify({ values: {} }) })).preferences);
    } catch {
      return null;
    }
  }
}

/** The account's preferences as `/me` or the socket's `welcome` read them: null when the account never
 * synced, which seeds it from this browser. Then sends whatever this page changed meanwhile. */
export function syncAccountPreferences(account: string, server: Record<string, unknown> | null): Promise<void> {
  syncing = syncing.then(async () => {
    let values: Preferences | null = server ? clean(server) : null;
    if (values === null) {
      // an earlier answer in this page already seeded it, this one only read before that landed
      if (accountId === account) { sendPending(); return; }
      values = await seed(account);
      if (values === null) return;
    }
    if (accountId !== account) {
      accountId = account;
      localStorageStore.set(OWNER_KEY, account);
    }
    confirmed = values;
    showConfirmed();
    sendPending();
  });
  return syncing;
}

/** `my-preferences`: a change from any tab of the account, this one included. A key this page changed
 * again since keeps the newer value, which the server hears next. */
export function receivePreferenceChanges(changes: Record<string, unknown>): void {
  if (!accountId) return;
  const next = new Map<string, PreferenceValue | null>();
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || isValidPreference(key, value)) next.set(key, value as PreferenceValue | null);
  }
  confirmed = withChanges(confirmed, next);
  showConfirmed();
}

/** Signing out: nothing more is sent for that account. The cache stays, so the sign-in screen keeps its look. */
export function forgetAccountPreferences(): void {
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = null;
  accountId = null;
  confirmed = {};
  pending = new Map();
  inFlight = null;
  syncing = Promise.resolve();
}

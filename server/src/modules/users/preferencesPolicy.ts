// The account preferences the server stores for the client (modules/users/preferences.ts) and the shape
// each value must have. The client owns their meaning and defaults: it reads a value it does not know (a
// theme a newer build removed) as its default, so the server checks shapes, not the lists of choices,
// and adding a theme needs no server change. Mirrored by web/src/shared/preferences/preferenceKinds.ts;
// server/tests/modules/users/preferencesPolicy.test.ts fails if the two drift apart.

export type PreferenceKind = 'token' | 'boolean' | 'skinTone' | 'volume' | 'idList';

export const PREFERENCE_KINDS: Readonly<Record<string, PreferenceKind>> = {
  colorTheme: 'token',
  density: 'token',
  font: 'token',
  timeFormat: 'token',
  'sounds.message': 'boolean',
  'sounds.mention': 'boolean',
  'sounds.call': 'boolean',
  'sounds.muteAll': 'boolean',
  emojiSkinTone: 'skinTone',
  showStats: 'boolean',
  hideAudioOnlyTiles: 'boolean',
  showTileBanners: 'boolean',
  compressImages: 'boolean',
  mirrorCameraPreview: 'boolean',
};

/** Keys that are one entry of a map: `callVolume:<userId>` (or `<userId>:screen`), `collapsed:<serverId>`.
 * Each entry is its own key so two devices changing different people's volumes never overwrite each other. */
export const PREFERENCE_PREFIXES: Readonly<Record<string, PreferenceKind>> = {
  'callVolume:': 'volume',
  'collapsed:': 'idList',
};

/** How many entries a map may hold, so an account cannot grow its row without bound. */
const PREFIX_LIMITS: Readonly<Record<string, number>> = { 'callVolume:': 1000, 'collapsed:': 200 };
const MAX_IDS_PER_LIST = 200;
/** Every plain key plus every map entry: what a seed can carry at most. */
export const MAX_CHANGES = Object.keys(PREFERENCE_KINDS).length + Object.values(PREFIX_LIMITS).reduce((a, b) => a + b, 0);

const TOKEN = /^[a-z0-9-]{1,32}$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const SUFFIX: Readonly<Record<string, RegExp>> = {
  'callVolume:': /^[A-Za-z0-9_-]{1,64}(:screen)?$/,
  'collapsed:': ID,
};

export type Preferences = Record<string, unknown>;
/** `null` puts a key back to the client's default, which is not stored. */
export type PreferenceChanges = Record<string, unknown>;

function kindOf(key: string): PreferenceKind | null {
  if (Object.hasOwn(PREFERENCE_KINDS, key)) return PREFERENCE_KINDS[key];
  for (const [prefix, kind] of Object.entries(PREFERENCE_PREFIXES)) {
    if (key.startsWith(prefix) && SUFFIX[prefix].test(key.slice(prefix.length))) return kind;
  }
  return null;
}

function validValue(kind: PreferenceKind, value: unknown): boolean {
  switch (kind) {
    case 'token': return typeof value === 'string' && TOKEN.test(value);
    case 'boolean': return typeof value === 'boolean';
    case 'skinTone': return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 5;
    case 'volume': return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
    case 'idList':
      return Array.isArray(value) && value.length > 0 && value.length <= MAX_IDS_PER_LIST
        && value.every((id) => typeof id === 'string' && ID.test(id));
  }
}

/** The changes of a request body, or null when it is not one: an object of known keys whose values have
 * the right shape (or are null, to clear), at most MAX_CHANGES of them. */
export function parsePreferenceChanges(body: unknown, { allowNull = true } = {}): PreferenceChanges | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const entries = Object.entries(body);
  if (entries.length > MAX_CHANGES) return null;
  const changes: PreferenceChanges = {};
  for (const [key, value] of entries) {
    const kind = kindOf(key);
    if (!kind) return null;
    if (value === null ? !allowNull : !validValue(kind, value)) return null;
    changes[key] = value;
  }
  return changes;
}

/** `current` with `changes` applied, or 'too_many' when a map would pass its limit. */
export function applyPreferenceChanges(current: Preferences, changes: PreferenceChanges): Preferences | 'too_many' {
  const next: Preferences = { ...current };
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  for (const [prefix, limit] of Object.entries(PREFIX_LIMITS)) {
    if (Object.keys(next).filter((key) => key.startsWith(prefix)).length > limit) return 'too_many';
  }
  return next;
}

/** A stored row read back, minus anything this build no longer knows or accepts. */
export function cleanStoredPreferences(data: unknown): Preferences {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  const clean: Preferences = {};
  for (const [key, value] of Object.entries(data)) {
    const kind = kindOf(key);
    if (kind && validValue(kind, value)) clean[key] = value;
  }
  return clean;
}

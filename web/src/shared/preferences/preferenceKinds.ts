// The keys of the preferences that follow the account and the shape of each value, as the server checks
// them (server/src/modules/users/preferencesPolicy.ts). Keep the two lists the same: a server test reads
// this file and fails when they drift apart.

export type PreferenceKind = 'token' | 'boolean' | 'skinTone' | 'volume' | 'idList';

export const PREFERENCE_KINDS = {
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
} as const satisfies Record<string, PreferenceKind>;

/** One entry of a map per key: `callVolume:<userId>` (or `<userId>:screen`), `collapsed:<serverId>`. */
export const PREFERENCE_PREFIXES = {
  'callVolume:': 'volume',
  'collapsed:': 'idList',
} as const satisfies Record<string, PreferenceKind>;

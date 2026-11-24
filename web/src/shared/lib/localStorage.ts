/** All persistent browser storage keys used by the frontend. Keep existing
 * names stable so users keep the preferences already saved in their browser. */
export const LOCAL_STORAGE_KEYS = {
  desktopAppAnnounced: 'ss-desktop-app-announced',
  language: 'ss-locale',
  mediaVolume: 'ss-media-volume',
  lastChannel: (serverId: string) => `ss-last-channel:${serverId}` as const,
  shareQuality: 'ss-share-quality',
  notificationsEnabled: 'ss-notifications-enabled',
  notifyVolume: 'ss-notify-volume',
  device: (kind: MediaDeviceKind) => `ss-device-${kind}` as const,
  /** the settings that follow the account, as last known (shared/preferences/accountPreferences.ts) */
  preferences: 'linkord.preferences',
  /** which account `preferences` was last synced with */
  preferencesOwner: 'linkord.preferencesOwner',
  /** colorTheme, density and font are kept beside `preferences` for index.html's boot script */
  colorTheme: 'linkord.colorTheme',
  density: 'linkord.density',
  textSize: 'linkord.textSize',
  font: 'linkord.font',
  inputVolume: 'ss-input-volume',
  inputProfile: 'ss-input-profile',
  outputVolume: 'ss-output-volume',
  soundboardVolume: 'ss-soundboard-volume',
  memberListOpen: 'ss-member-list-open',
  memberListOverlayOpen: 'ss-member-list-open:overlay',
  channelListOverlayOpen: 'ss-channel-list-open:overlay',
  dmCallHeight: 'ss-dm-call-height',
  legacyNoiseSuppression: 'ss-noise-suppression',
  autoIdleMinutes: 'ss-auto-idle-minutes',
  /** '0' when the playground should not go fullscreen on the click that starts playing */
  playgroundAutoFullscreen: 'ss-playground-auto-fullscreen',
  /** the playground skin as base64 PNG, from before it was kept with the account; read once to move it there */
  legacyPlaygroundSkin: 'ss-playground-skin',
  /** the recent searches of one server, or of one DM */
  searchHistory: (contextId: string) => `ss-search-history:${contextId}` as const,
} as const;

type RegistryValue = (typeof LOCAL_STORAGE_KEYS)[keyof typeof LOCAL_STORAGE_KEYS];
type DynamicKeyFactory = Extract<RegistryValue, (...args: never[]) => string>;
export type LocalStorageKey = Exclude<RegistryValue, DynamicKeyFactory> | ReturnType<DynamicKeyFactory>;

/** Best-effort localStorage access. Features own their value formats and
 * defaults; blocked or unavailable browser storage must not break the app. */
export const localStorageStore = {
  get(key: LocalStorageKey): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },

  set(key: LocalStorageKey, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Persistent preferences are best-effort when browser storage is blocked.
    }
  },

  remove(key: LocalStorageKey): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Missing persistence must not interrupt the current session.
    }
  },
};

/** Older builds saved a desktop collapse flag. The column no longer collapses,
 * and a leftover `'1'` hid it with no control to open it again. */
const LEGACY_SIDEBAR_COLLAPSED = 'ss-sidebar-collapsed';

export function discardLegacySidebarCollapsed(): void {
  try {
    window.localStorage.removeItem(LEGACY_SIDEBAR_COLLAPSED);
  } catch {
    // Persistent preferences are best-effort when browser storage is blocked.
  }
}

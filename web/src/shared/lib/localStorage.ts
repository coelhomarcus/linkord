/** All persistent browser storage keys used by the frontend. Keep existing
 * names stable so users keep the preferences already saved in their browser. */
export const LOCAL_STORAGE_KEYS = {
  language: 'ss-locale',
  mediaVolume: 'ss-media-volume',
  lastChannel: (serverId: string) => `ss-last-channel:${serverId}` as const,
  collapsedCategories: (serverId: string) => `ss-collapsed-categories:${serverId}` as const,
  shareQuality: 'ss-share-quality',
  sidebarCollapsed: 'ss-sidebar-collapsed',
  notificationsEnabled: 'ss-notifications-enabled',
  compressImages: 'ss-compress-images',
  callVolumes: 'ss-call-volumes',
  hideAudioOnlyTiles: 'ss-hide-audio-only-tiles',
  showTileBanners: 'ss-show-tile-banners',
  showStats: 'ss-show-stats',
  notifyVolume: 'ss-notify-volume',
  mirrorCameraPreview: 'ss-mirror-camera-preview',
  device: (kind: MediaDeviceKind) => `ss-device-${kind}` as const,
  colorTheme: 'linkord.colorTheme',
  inputVolume: 'ss-input-volume',
  inputProfile: 'ss-input-profile',
  outputVolume: 'ss-output-volume',
  soundboardVolume: 'ss-soundboard-volume',
  memberListOpen: 'ss-member-list-open',
  legacyNoiseSuppression: 'ss-noise-suppression',
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

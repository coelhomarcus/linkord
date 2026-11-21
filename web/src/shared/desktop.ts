// What the desktop app's preload exposes (desktop/src/preload/index.cts).
// Every field but platform and version is optional: a desktop build older
// than the feature lacks it, and the web app must then behave as before.

export interface DesktopSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** data: URL, or null when the system gave no preview */
  thumbnail: string | null;
  appIcon: string | null;
}

export interface DesktopScreenShare {
  /** 'system': the OS shows its own picker. 'app': the page lists and picks the source. */
  picker: 'system' | 'app';
  /** whether the share can carry the computer's sound (Windows) */
  systemAudio: boolean;
  listSources: () => Promise<DesktopSource[]>;
  select: (id: string, audio: boolean) => Promise<boolean>;
}

export interface DesktopWindowState {
  maximized: boolean;
  fullScreen: boolean;
  focused: boolean;
}

/** The window has no system title bar: the page draws one with these buttons. */
export interface DesktopWindowControls {
  /** whose buttons to draw; the platform's when absent */
  style?: 'mac' | 'windows' | 'linux';
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  /** what closing does is the desktop app's call (it hides to the tray) */
  close: () => Promise<void>;
  getState: () => Promise<DesktopWindowState | null>;
  /** returns the unsubscribe */
  onStateChange: (callback: (state: DesktopWindowState) => void) => () => void;
}

export type DesktopUpdateStatus =
  | { kind: 'idle' }
  | { kind: 'available'; version: string; url: string }
  /** only from builds with the updater window; older ones go from idle to downloaded */
  | { kind: 'downloading'; version: string; percent: number }
  | { kind: 'downloaded'; version: string };

/** The desktop app's own settings, as features/settings/DesktopSettings shows them. */
export interface DesktopSettingsSnapshot {
  version: string;
  startAtLogin: { available: boolean; enabled: boolean };
  /** closing the window keeps the app in the tray instead of quitting */
  closeToTray: boolean;
  /** a start with the system stays in the tray */
  startMinimized: boolean;
  /** 'install': the Windows build updates itself; 'off': a build that does not check. 'notify' (and
   * the 'available' status) only come from older macOS and Linux builds, sent to a page to download from */
  update: { mode: 'install' | 'notify' | 'off'; status: DesktopUpdateStatus };
}

export type DesktopUpdateCheck = { kind: 'up-to-date' } | { kind: 'update'; version: string } | { kind: 'failed' } | { kind: 'off' };

export interface DesktopSettingsApi {
  get: () => Promise<DesktopSettingsSnapshot | null>;
  set: (change: Partial<{ startAtLogin: boolean; closeToTray: boolean; startMinimized: boolean }>) => Promise<DesktopSettingsSnapshot | null>;
  checkForUpdates: () => Promise<DesktopUpdateCheck>;
  applyUpdate: () => Promise<void>;
  /** the tray or the menu changed something; returns the unsubscribe */
  onChange: (callback: (settings: DesktopSettingsSnapshot) => void) => () => void;
}

/** What the desktop app found running (desktop/src/main/activityWatcher.ts). */
export interface DesktopActivity {
  key: string;
  kind: 'playing' | 'using';
  /** empty for a Steam game whose name the app could not read: the server's lookup names it */
  name: string;
  steamAppId?: number;
  /** ms */
  startedAt: number;
}

export interface DesktopActivityApi {
  /** turns detection on (while the account shares its activity) or off */
  watch: (on: boolean) => Promise<void>;
  current: () => Promise<DesktopActivity | null>;
  /** the last ones found, newest first, for hiding them in settings */
  recent: () => Promise<{ key: string; kind: 'playing' | 'using'; name: string }[]>;
  /** the current program's own icon as a data URL, or null */
  icon: () => Promise<string | null>;
  onChange: (callback: (activity: DesktopActivity | null) => void) => () => void;
  /** what runs now and the one picked by hand; absent in builds that pick the first one found */
  running?: () => Promise<DesktopRunningActivities>;
  /** the activity to show whenever it runs, or null to choose automatically */
  prefer?: (key: string | null) => Promise<void>;
  /** the keys the account hides, so the app shows another one instead of nothing */
  setHidden?: (keys: string[]) => Promise<void>;
  onRunningChange?: (callback: (running: DesktopRunningActivities) => void) => () => void;
}

export interface DesktopRunningActivities {
  running: { key: string; kind: 'playing' | 'using'; name: string }[];
  preferred: string | null;
}

/** A notification for the system's own centre (desktop/src/main/notificationLayout.ts checks it). */
export interface DesktopNotificationRequest {
  /** the notification's tag: a newer one with the same id replaces it */
  id: string;
  title: string;
  body: string;
  /** a PNG data URL; anything else shows the app icon */
  icon?: string | null;
  /** a conversation's notifications stack together */
  group?: string | null;
}

export interface DesktopNotifications {
  /** false when it was not shown (a request it refused, or no notifications on this system) */
  show: (request: DesktopNotificationRequest) => Promise<boolean>;
  /** the id of the notification clicked, once the window is back; returns the unsubscribe */
  onClick: (callback: (id: string) => void) => () => void;
}

export interface LinkordDesktop {
  platform: string;
  version: string;
  screenShare?: DesktopScreenShare;
  /** brings the window back, hidden or minimised included */
  focusWindow?: () => Promise<void>;
  /** `linkord://` links opened while the app runs, as paths on this origin (an invite, a
   * conversation); returns the unsubscribe. Absent in builds without deep links. */
  onDeepLink?: (callback: (path: string) => void) => () => void;
  /** the count on the dock or launcher icon; false where the system shows none (Windows) */
  setBadgeCount?: (count: number) => Promise<boolean>;
  /** absent in builds that show the page's web notifications instead */
  notifications?: DesktopNotifications;
  /** absent in builds that keep the system title bar */
  windowControls?: DesktopWindowControls;
  /** absent in builds without the app's own settings */
  settings?: DesktopSettingsApi;
  /** absent in builds that detect nothing */
  activity?: DesktopActivityApi;
}

declare global {
  interface Window {
    linkordDesktop?: LinkordDesktop;
  }
}

export function desktopApp(): LinkordDesktop | null {
  return typeof window === 'undefined' ? null : window.linkordDesktop ?? null;
}

export function isDesktopApp(): boolean {
  return desktopApp() !== null;
}

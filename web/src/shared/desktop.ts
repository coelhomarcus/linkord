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

export interface LinkordDesktop {
  platform: string;
  version: string;
  screenShare?: DesktopScreenShare;
  /** brings the window back, hidden or minimised included */
  focusWindow?: () => Promise<void>;
  /** the count on the dock or launcher icon; false where the system shows none (Windows) */
  setBadgeCount?: (count: number) => Promise<boolean>;
  /** absent in builds that keep the system title bar */
  windowControls?: DesktopWindowControls;
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

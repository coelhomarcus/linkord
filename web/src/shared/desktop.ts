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

export interface LinkordDesktop {
  platform: string;
  version: string;
  screenShare?: DesktopScreenShare;
  /** brings the window back, hidden or minimised included */
  focusWindow?: () => Promise<void>;
  /** the count on the dock or launcher icon; false where the system shows none (Windows) */
  setBadgeCount?: (count: number) => Promise<boolean>;
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

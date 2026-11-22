// What the person chose in the app's settings (web: features/settings/DesktopSettings).
// Start at login itself is the system's (a login item or an autostart entry),
// so only what the system does not keep lives here.

export interface DesktopPreferences {
  /** closing the window keeps the app in the tray instead of quitting */
  closeToTray: boolean;
  /** a start with the system leaves the window closed, in the tray */
  startMinimized: boolean;
}

export const DEFAULT_PREFERENCES: DesktopPreferences = { closeToTray: true, startMinimized: true };

const KEYS = Object.keys(DEFAULT_PREFERENCES) as (keyof DesktopPreferences)[];

/** The saved file, with defaults for anything missing or of the wrong type. */
export function parsePreferences(raw: unknown): DesktopPreferences {
  return { ...DEFAULT_PREFERENCES, ...parsePreferenceChange(raw) };
}

/** A change sent by the page: only known keys with a true or false. */
export function parsePreferenceChange(raw: unknown): Partial<DesktopPreferences> {
  if (!raw || typeof raw !== 'object') return {};
  const change: Partial<DesktopPreferences> = {};
  for (const key of KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === 'boolean') change[key] = value;
  }
  return change;
}

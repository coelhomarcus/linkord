import { getPreference, setPreference, usePreferenceValue } from '@/shared/preferences/accountPreferences';

/** What a sound tells you, the unit a person turns on or off in settings. */
export type SoundGroup = 'message' | 'mention' | 'call';

export interface SoundPreferences {
  message: boolean;
  mention: boolean;
  call: boolean;
  /** Silences every group while keeping their own switches, so turning it
   * back off restores exactly what was on before. */
  muteAll: boolean;
}

const DEFAULTS: SoundPreferences = { message: true, mention: true, call: true, muteAll: false };

const GROUPS = ['message', 'mention', 'call', 'muteAll'] as const satisfies readonly (keyof SoundPreferences)[];

// useSyncExternalStore needs the same object back while nothing changed.
let cached: SoundPreferences = DEFAULTS;

export function getSoundPreferences(): SoundPreferences {
  const read = (key: keyof SoundPreferences) => {
    const value = getPreference(`sounds.${key}`);
    return typeof value === 'boolean' ? value : DEFAULTS[key];
  };
  const next: SoundPreferences = { message: read('message'), mention: read('mention'), call: read('call'), muteAll: read('muteAll') };
  if (GROUPS.some((key) => next[key] !== cached[key])) cached = next;
  return cached;
}

/** Follows the account: what plays is the same on every device. */
export function setSoundPreference(key: keyof SoundPreferences, value: boolean): void {
  setPreference(`sounds.${key}`, value === DEFAULTS[key] ? null : value);
}

export function soundGroupEnabled(group: SoundGroup, prefs: SoundPreferences = getSoundPreferences()): boolean {
  return !prefs.muteAll && prefs[group];
}

export function useSoundPreferences(): SoundPreferences {
  return usePreferenceValue(getSoundPreferences);
}

import { useSyncExternalStore } from 'react';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

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

const listeners = new Set<() => void>();
let cached: SoundPreferences | null = null;
let cachedRaw: string | null | undefined;

function parse(raw: string | null): SoundPreferences {
  if (!raw) return DEFAULTS;
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof SoundPreferences, unknown>>;
    const pick = (key: keyof SoundPreferences) => (typeof value[key] === 'boolean' ? value[key] as boolean : DEFAULTS[key]);
    return { message: pick('message'), mention: pick('mention'), call: pick('call'), muteAll: pick('muteAll') };
  } catch {
    return DEFAULTS;
  }
}

// useSyncExternalStore needs the same object back while nothing changed.
export function getSoundPreferences(): SoundPreferences {
  const raw = localStorageStore.get(LOCAL_STORAGE_KEYS.sounds);
  if (cached && raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = parse(raw);
  return cached;
}

export function setSoundPreference(key: keyof SoundPreferences, value: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.sounds, JSON.stringify({ ...getSoundPreferences(), [key]: value }));
  for (const listener of listeners) listener();
}

export function soundGroupEnabled(group: SoundGroup, prefs: SoundPreferences = getSoundPreferences()): boolean {
  return !prefs.muteAll && prefs[group];
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useSoundPreferences(): SoundPreferences {
  return useSyncExternalStore(subscribe, getSoundPreferences);
}

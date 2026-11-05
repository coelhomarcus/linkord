import { useSyncExternalStore } from 'react';
import { LOCAL_STORAGE_KEYS, localStorageStore, type LocalStorageKey } from '@/shared/lib/localStorage';

export type InputProfile = 'voice-isolation' | 'studio';

export interface AudioPreferences {
  /** 0..1 gain applied to the published microphone. */
  inputVolume: number;
  inputProfile: InputProfile;
  /** 0..1, multiplied into every participant's own volume. */
  outputVolume: number;
}

const STORAGE_KEYS: Record<keyof AudioPreferences, LocalStorageKey> = {
  inputVolume: LOCAL_STORAGE_KEYS.inputVolume,
  inputProfile: LOCAL_STORAGE_KEYS.inputProfile,
  outputVolume: LOCAL_STORAGE_KEYS.outputVolume,
};

function loadUnit(key: LocalStorageKey): number {
  const raw = localStorageStore.get(key);
  if (raw == null) return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
}

function read(): AudioPreferences {
  return {
    inputVolume: loadUnit(STORAGE_KEYS.inputVolume),
    inputProfile: localStorageStore.get(STORAGE_KEYS.inputProfile) === 'studio' ? 'studio' : 'voice-isolation',
    outputVolume: loadUnit(STORAGE_KEYS.outputVolume),
  };
}

const listeners = new Set<() => void>();
let cached: AudioPreferences | null = null;

// useSyncExternalStore needs the same object back while nothing changed.
export function getAudioPreferences(): AudioPreferences {
  const next = read();
  if (cached && cached.inputVolume === next.inputVolume && cached.inputProfile === next.inputProfile && cached.outputVolume === next.outputVolume) {
    return cached;
  }
  cached = next;
  return next;
}

export function setAudioPreference<K extends keyof AudioPreferences>(key: K, value: AudioPreferences[K]): void {
  localStorageStore.set(STORAGE_KEYS[key], String(value));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAudioPreferences(): AudioPreferences {
  return useSyncExternalStore(subscribe, getAudioPreferences);
}

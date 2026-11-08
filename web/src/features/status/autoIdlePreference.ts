import { useSyncExternalStore } from 'react';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

/** Minutes without input before this device counts as away; 0 turns it off. Per device on purpose:
 * how long a desktop sits untouched says nothing about a phone. */
export const AUTO_IDLE_OPTIONS = [0, 5, 10, 15, 30] as const;
export type AutoIdleMinutes = (typeof AUTO_IDLE_OPTIONS)[number];
const DEFAULT_MINUTES: AutoIdleMinutes = 10;

const listeners = new Set<() => void>();

function getAutoIdleMinutes(): AutoIdleMinutes {
  const stored = localStorageStore.get(LOCAL_STORAGE_KEYS.autoIdleMinutes);
  const minutes = stored === null ? NaN : Number(stored);
  return (AUTO_IDLE_OPTIONS as readonly number[]).includes(minutes) ? minutes as AutoIdleMinutes : DEFAULT_MINUTES;
}

export function setAutoIdleMinutes(value: AutoIdleMinutes): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.autoIdleMinutes, String(value));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useAutoIdleMinutes(): AutoIdleMinutes {
  return useSyncExternalStore(subscribe, getAutoIdleMinutes);
}

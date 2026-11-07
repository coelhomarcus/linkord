import { useSyncExternalStore } from 'react';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

/** 'auto' follows the interface language (24h in pt-BR, 12h in en-US). */
export type TimeFormat = 'auto' | '12h' | '24h';
export const TIME_FORMATS: readonly TimeFormat[] = ['auto', '12h', '24h'];

const listeners = new Set<() => void>();

export function getTimeFormat(): TimeFormat {
  const raw = localStorageStore.get(LOCAL_STORAGE_KEYS.timeFormat);
  return raw === '12h' || raw === '24h' ? raw : 'auto';
}

export function setTimeFormat(value: TimeFormat): void {
  if (value === 'auto') localStorageStore.remove(LOCAL_STORAGE_KEYS.timeFormat);
  else localStorageStore.set(LOCAL_STORAGE_KEYS.timeFormat, value);
  for (const listener of listeners) listener();
}

/** Hour and minute options for toLocale*String. A 12-hour clock reads "9:05 PM",
 * a 24-hour one "21:05" / "09:05": the leading zero only belongs to the latter. */
export function timeOptions(language: string, format: TimeFormat = getTimeFormat()): Intl.DateTimeFormatOptions {
  const twelve = format === 'auto'
    ? new Intl.DateTimeFormat(language, { hour: 'numeric' }).resolvedOptions().hour12 ?? false
    : format === '12h';
  return { hour: twelve ? 'numeric' : '2-digit', minute: '2-digit', hour12: twelve };
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Re-renders whoever prints a time when the format changes in settings. */
export function useTimeFormat(): TimeFormat {
  return useSyncExternalStore(subscribe, getTimeFormat);
}

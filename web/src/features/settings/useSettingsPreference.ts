import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { getPreference, setPreference } from '@/shared/preferences/accountPreferences';

export function loadShowStats(): boolean {
  return getPreference('showStats') !== false;
}

export function saveShowStats(value: boolean): void {
  setPreference('showStats', value ? null : false);
}

// The notification volume stays on this device: it depends on its speakers.
const DEFAULT_NOTIFY_VOLUME = 0.65;

export function loadNotifyVolume(): number {
  const raw = localStorageStore.get(LOCAL_STORAGE_KEYS.notifyVolume);
  if (raw == null) return DEFAULT_NOTIFY_VOLUME;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : DEFAULT_NOTIFY_VOLUME;
}

export function saveNotifyVolume(value: number): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.notifyVolume, String(value));
}

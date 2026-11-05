
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

export function loadShowStats(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.showStats) !== '0';
}

export function saveShowStats(value: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.showStats, value ? '1' : '0');
}

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

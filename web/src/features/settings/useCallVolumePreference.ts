
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

function loadAll(): Record<string, number> {
  try {
    const raw = localStorageStore.get(LOCAL_STORAGE_KEYS.callVolumes);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadCallVolume(key: string): number {
  const v = loadAll()[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

export function saveCallVolume(key: string, value: number): void {
  const all = loadAll();
  all[key] = value;
  localStorageStore.set(LOCAL_STORAGE_KEYS.callVolumes, JSON.stringify(all));
}


import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

export function loadDevicePreference(kind: MediaDeviceKind): string | null {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.device(kind));
}

export function saveDevicePreference(kind: MediaDeviceKind, deviceId: string): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.device(kind), deviceId);
}

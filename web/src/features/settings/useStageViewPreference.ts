
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

export function loadHideAudioOnlyTiles(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.hideAudioOnlyTiles) === '1';
}

export function saveHideAudioOnlyTiles(value: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.hideAudioOnlyTiles, value ? '1' : '0');
}

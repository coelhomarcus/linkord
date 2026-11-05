import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

export function loadShowTileBanners(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.showTileBanners) !== '0';
}

export function saveShowTileBanners(value: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.showTileBanners, value ? '1' : '0');
}

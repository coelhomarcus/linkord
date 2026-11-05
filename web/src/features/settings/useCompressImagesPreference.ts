import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

export function loadCompressImages(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.compressImages) !== '0';
}

export function saveCompressImages(value: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.compressImages, value ? '1' : '0');
}

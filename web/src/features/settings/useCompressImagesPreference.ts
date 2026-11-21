import { getPreference, setPreference } from '@/shared/preferences/accountPreferences';

export function loadCompressImages(): boolean {
  return getPreference('compressImages') !== false;
}

export function saveCompressImages(value: boolean): void {
  setPreference('compressImages', value ? null : false);
}

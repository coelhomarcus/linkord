import { getPreference, setPreference } from '@/shared/preferences/accountPreferences';

export function loadShowTileBanners(): boolean {
  return getPreference('showTileBanners') !== false;
}

export function saveShowTileBanners(value: boolean): void {
  setPreference('showTileBanners', value ? null : false);
}

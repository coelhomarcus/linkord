import { getPreference, setPreference } from '@/shared/preferences/accountPreferences';

export function loadHideAudioOnlyTiles(): boolean {
  return getPreference('hideAudioOnlyTiles') === true;
}

export function saveHideAudioOnlyTiles(value: boolean): void {
  setPreference('hideAudioOnlyTiles', value ? true : null);
}

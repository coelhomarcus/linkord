import { getPreference, setPreference } from '@/shared/preferences/accountPreferences';

// The volume given to one person (`<userId>`) or to their shared screen (`<userId>:screen`), 0..1. It
// follows the account, so someone turned down on the desktop is just as quiet on the phone.

export function loadCallVolume(key: string): number {
  const v = getPreference(`callVolume:${key}`);
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

export function saveCallVolume(key: string, value: number): void {
  const volume = Math.max(0, Math.min(1, value));
  setPreference(`callVolume:${key}`, volume === 1 ? null : volume);
}

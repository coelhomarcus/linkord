import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

export const DEFAULT_DM_CALL_HEIGHT = 320;
/** room for the smallest avatars above the control bar */
export const MIN_DM_CALL_HEIGHT = 180;

export function clampDmCallHeight(height: number, max: number): number {
  return Math.round(Math.max(MIN_DM_CALL_HEIGHT, Math.min(Math.max(MIN_DM_CALL_HEIGHT, max), height)));
}

export function loadDmCallHeight(): number {
  const raw = localStorageStore.get(LOCAL_STORAGE_KEYS.dmCallHeight);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n >= MIN_DM_CALL_HEIGHT ? Math.round(n) : DEFAULT_DM_CALL_HEIGHT;
}

export function saveDmCallHeight(height: number): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.dmCallHeight, String(Math.round(height)));
}

import { apiFetch } from '@/shared/api/api';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { skinFromBase64, skinToBase64 } from './skins';

// The skin is kept with the account (server modules/playground), so it follows
// it across reloads and devices and anyone in the call can read it.

/** The PNG someone wears, or null for their account's default. */
export async function fetchAccountSkin(userId: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const { skin } = await apiFetch<{ skin: string | null }>(`/api/users/${encodeURIComponent(userId)}/playground-skin`);
  return skin ? skinFromBase64(skin) : null;
}

/** Wears `bytes` (a PNG from encodeSkin) on every device, or the default with null. */
export async function saveAccountSkin(bytes: Uint8Array | null): Promise<void> {
  if (!bytes) {
    await apiFetch<void>('/api/me/playground-skin', { method: 'DELETE' });
    return;
  }
  await apiFetch('/api/me/playground-skin', { method: 'PUT', body: JSON.stringify({ skin: skinToBase64(bytes) }) });
}

// Before skins were kept with the account they lived in this browser: the
// first playground after the change moves that one over, then forgets it.
const LEGACY_KEY = LOCAL_STORAGE_KEYS.legacyPlaygroundSkin;

export function takeLegacySkin(): Uint8Array<ArrayBuffer> | null {
  const stored = localStorageStore.get(LEGACY_KEY);
  if (!stored) return null;
  return skinFromBase64(stored);
}

export function forgetLegacySkin(): void {
  localStorageStore.remove(LEGACY_KEY);
}

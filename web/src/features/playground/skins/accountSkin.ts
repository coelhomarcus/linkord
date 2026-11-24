import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import type { ServiceLink } from '../playgroundLink';
import { skinFromBase64, skinToBase64 } from './skins';

// The skin is kept with the account by the playground service
// (playground/src/skins.ts), so it follows it across reloads and devices and
// anyone in the call can read it.

/** The PNG someone in your call wears (or you), or null for their account's default. */
export async function fetchAccountSkin(userId: string, link: Pick<ServiceLink, 'request'>): Promise<Uint8Array<ArrayBuffer> | null> {
  const { skin } = await link.request({ event: 'skin-get', payload: { userId } });
  return typeof skin === 'string' && skin ? skinFromBase64(skin) : null;
}

/** Wears `bytes` (a PNG from encodeSkin) on every device, or the default with null. */
export async function saveAccountSkin(bytes: Uint8Array | null, link: Pick<ServiceLink, 'request'>): Promise<void> {
  await link.request({ event: 'skin-set', payload: { skin: bytes ? skinToBase64(bytes) : null } });
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

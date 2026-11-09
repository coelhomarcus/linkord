import { useSyncExternalStore } from 'react';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

// The skin tone picked in the emoji picker, for this browser: 0 is the
// default yellow, 1..5 light to dark. Applied wherever an emoji with tones
// is inserted from a list (the picker, the composer's suggestions).

const listeners = new Set<() => void>();

function read(): number {
  const n = Number(localStorageStore.get(LOCAL_STORAGE_KEYS.emojiSkinTone));
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0;
}

let current = read();

export function setSkinTone(tone: number): void {
  current = Math.max(0, Math.min(5, Math.round(tone)));
  localStorageStore.set(LOCAL_STORAGE_KEYS.emojiSkinTone, String(current));
  for (const listener of listeners) listener();
}

export function useSkinTone(): number {
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => current,
  );
}

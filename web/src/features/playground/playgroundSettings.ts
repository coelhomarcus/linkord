import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';

// The playground's own settings, kept in this browser: how a game plays fits the device it is
// played on, so they do not follow the account.

/** Whether the click that starts playing also goes fullscreen (and so keeps Esc and Ctrl+W in the
 * game). On unless turned off. */
export function loadAutoFullscreen(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.playgroundAutoFullscreen) !== '0';
}

export function saveAutoFullscreen(on: boolean): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.playgroundAutoFullscreen, on ? '1' : '0');
}

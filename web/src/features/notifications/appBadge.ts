import { apiFetch } from '@/shared/api/api';
import { desktopApp } from '@/shared/desktop';

// The desktop app sets the dock or launcher count itself; a browser does it
// through the Badging API, which only an installed web app has
async function setBadge(count: number): Promise<void> {
  const setDesktopBadge = desktopApp()?.setBadgeCount;
  if (setDesktopBadge) {
    await setDesktopBadge(count);
    return;
  }
  if (count === 0 && typeof navigator.clearAppBadge === 'function') await navigator.clearAppBadge();
  else if (typeof navigator.setAppBadge === 'function') await navigator.setAppBadge(count);
}

function canBadge(): boolean {
  return Boolean(desktopApp()?.setBadgeCount) || typeof navigator.setAppBadge === 'function';
}

export async function clearAppBadge(): Promise<void> {
  try {
    await setBadge(0);
  } catch { /* the OS may refuse badges even when the browser exposes the API */ }
}

export async function refreshAppBadge(signal?: AbortSignal): Promise<void> {
  if (!canBadge()) return;
  try {
    const { count } = await apiFetch<{ count: number }>('/api/notifications/badge', { signal, cache: 'no-store' });
    if (signal?.aborted || !Number.isSafeInteger(count) || count < 0) return;
    await setBadge(count);
  } catch { /* preserve the last badge until the app can reach the server again */ }
}

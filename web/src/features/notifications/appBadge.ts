import { apiFetch } from '@/shared/api/api';

export async function clearAppBadge(): Promise<void> {
  try {
    if (typeof navigator.clearAppBadge === 'function') await navigator.clearAppBadge();
    else if (typeof navigator.setAppBadge === 'function') await navigator.setAppBadge(0);
  } catch { /* the OS may refuse badges even when the browser exposes the API */ }
}

export async function refreshAppBadge(signal?: AbortSignal): Promise<void> {
  if (typeof navigator.setAppBadge !== 'function') return;
  try {
    const { count } = await apiFetch<{ count: number }>('/api/notifications/badge', { signal, cache: 'no-store' });
    if (signal?.aborted || !Number.isSafeInteger(count) || count < 0) return;
    if (count === 0) await clearAppBadge();
    else await navigator.setAppBadge(count);
  } catch { /* preserve the last badge until the app can reach the server again */ }
}

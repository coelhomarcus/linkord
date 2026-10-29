import { apiFetch } from '@/shared/api/api';
import { loadNotificationsEnabled, setPushSubscriptionActive } from '@/shared/notifications';

interface PushConfig { available: boolean; publicKey: string | null }
export interface PushSetup { registration: ServiceWorkerRegistration; publicKey: Uint8Array<ArrayBuffer> }

function decodePublicKey(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
  return new Uint8Array(bytes);
}

export function pushSupported(): boolean {
  return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function preparePush(): Promise<PushSetup | null> {
  if (!pushSupported()) return null;
  const config = await apiFetch<PushConfig>('/api/notifications/push/config');
  if (!config.available || !config.publicKey) return null;
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  return { registration, publicKey: decodePublicKey(config.publicKey) };
}

/** Call directly in a tap handler. On iOS a subscribe prompt needs that
 * gesture; the worker and VAPID key were prepared before the tap. */
export async function enablePush(setup: PushSetup): Promise<void> {
  const subscription = await setup.registration.pushManager.subscribe({
    userVisibleOnly: true, applicationServerKey: setup.publicKey,
  });
  try {
    await apiFetch('/api/notifications/push', { method: 'POST', body: JSON.stringify(subscription) });
  } catch (err) {
    await subscription.unsubscribe();
    setPushSubscriptionActive(false);
    throw err;
  }
  setPushSubscriptionActive(true);
}

export async function disablePush(): Promise<void> {
  setPushSubscriptionActive(false);
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await apiFetch('/api/notifications/push', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  } finally {
    await subscription.unsubscribe();
  }
}

/** Browser subscriptions can change without an app event. Reconcile every
 * signed-in launch; an already granted permission needs no new prompt. */
let restoring: Promise<void> | null = null;
export function restorePush(): Promise<void> {
  if (restoring) return restoring;
  restoring = (async () => {
    if (!loadNotificationsEnabled() || !pushSupported() || Notification.permission !== 'granted') return;
    const setup = await preparePush();
    if (!setup) return;
    const existing = await setup.registration.pushManager.getSubscription();
    if (existing) {
      await apiFetch('/api/notifications/push', { method: 'POST', body: JSON.stringify(existing) });
      setPushSubscriptionActive(true);
    } else {
      await enablePush(setup);
    }
  })().finally(() => { restoring = null; });
  return restoring;
}

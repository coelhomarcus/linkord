import { apiFetch } from '@/shared/api/api';
import { loadNotificationsEnabled, saveNotificationsEnabled, setNotificationsModuleEnabled, setPushSubscriptionActive } from '@/shared/notifications';

interface PushConfig { available: boolean; publicKey: string | null }
export interface PushSetup { registration: ServiceWorkerRegistration; publicKey: Uint8Array<ArrayBuffer> }

let restoring: Promise<void> | null = null;
let activating: Promise<void> | null = null;
let generation = 0;

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

export function subscriptionUsesKey(subscription: PushSubscription, publicKey: Uint8Array<ArrayBuffer>): boolean {
  const current = subscription.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === publicKey.length && bytes.every((byte, index) => byte === publicKey[index]);
}

/** Call directly in a tap handler. On iOS a subscribe prompt needs that
 * gesture; the worker and VAPID key were prepared before the tap. */
export function enablePush(setup: PushSetup): Promise<void> {
  const manager = setup.registration.pushManager;
  const options = {
    userVisibleOnly: true, applicationServerKey: setup.publicKey,
  };
  const firstSubscription = manager.subscribe(options);
  const operation = (async () => {
    let subscription: PushSubscription;
    try {
      subscription = await firstSubscription;
    } catch (err) {
      const existing = await manager.getSubscription();
      if (!existing || subscriptionUsesKey(existing, setup.publicKey)) throw err;
      await existing.unsubscribe();
      subscription = await manager.subscribe(options);
    }
    try {
      await apiFetch('/api/notifications/push', { method: 'POST', body: JSON.stringify(subscription) });
    } catch (err) {
      await subscription.unsubscribe();
      setPushSubscriptionActive(false);
      throw err;
    }
    setPushSubscriptionActive(true);
  })();
  activating = operation;
  return operation.finally(() => { if (activating === operation) activating = null; });
}

export async function disablePush(): Promise<void> {
  generation++;
  saveNotificationsEnabled(false);
  setNotificationsModuleEnabled(false);
  setPushSubscriptionActive(false);
  await Promise.allSettled([restoring, activating].filter((pending): pending is Promise<void> => pending !== null));
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  try {
    await apiFetch('/api/notifications/push', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
  } finally {
    await subscription.unsubscribe();
    setPushSubscriptionActive(false);
  }
}

/** Browser subscriptions can change without an app event. Reconcile every
 * signed-in launch; an already granted permission needs no new prompt. */
export function restorePush(): Promise<void> {
  if (restoring) return restoring;
  const currentGeneration = generation;
  restoring = (async () => {
    if (!loadNotificationsEnabled() || !pushSupported() || Notification.permission !== 'granted') return;
    const setup = await preparePush();
    if (!setup || currentGeneration !== generation || !loadNotificationsEnabled()) return;
    const existing = await setup.registration.pushManager.getSubscription();
    if (currentGeneration !== generation || !loadNotificationsEnabled()) return;
    if (existing && subscriptionUsesKey(existing, setup.publicKey)) {
      await apiFetch('/api/notifications/push', { method: 'POST', body: JSON.stringify(existing) });
      setPushSubscriptionActive(true);
    } else {
      if (existing) await existing.unsubscribe();
      if (currentGeneration !== generation || !loadNotificationsEnabled()) return;
      await enablePush(setup);
    }
  })().finally(() => { restoring = null; });
  return restoring;
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { disablePush, enablePush, restorePush, type PushSetup } from '@/shared/pushNotifications';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/api', () => ({ apiFetch }));

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/example',
  keys: { p256dh: 'key', auth: 'auth' },
  options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
  unsubscribe: vi.fn(),
};
const subscribe = vi.fn();
const getSubscription = vi.fn();
const setup = { registration: { pushManager: { subscribe, getSubscription } }, publicKey: new Uint8Array([1, 2, 3]) } as unknown as PushSetup;
const secureContextDescriptor = Object.getOwnPropertyDescriptor(window, 'isSecureContext');

function stubSupportedBrowser() {
  vi.stubGlobal('navigator', { serviceWorker: {
    register: vi.fn(async () => setup.registration), ready: Promise.resolve(setup.registration),
    getRegistration: vi.fn(async () => setup.registration),
  } });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'granted' });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
}

beforeEach(() => {
  subscribe.mockReset().mockResolvedValue(subscription);
  getSubscription.mockReset().mockResolvedValue(subscription);
  subscription.unsubscribe.mockReset().mockResolvedValue(true);
  apiFetch.mockReset().mockResolvedValue({ ok: true });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (secureContextDescriptor) Object.defineProperty(window, 'isSecureContext', secureContextDescriptor);
  else Reflect.deleteProperty(window, 'isSecureContext');
});

describe('Web Push activation', () => {
  it('starts subscription synchronously in the user gesture and registers it for the account', async () => {
    const pending = enablePush(setup);
    expect(subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: setup.publicKey });
    await pending;
    expect(apiFetch).toHaveBeenCalledWith('/api/notifications/push', {
      method: 'POST', body: JSON.stringify(subscription),
    });
  });

  it('revokes a subscription when account registration fails', async () => {
    apiFetch.mockRejectedValue(new Error('server unavailable'));
    await expect(enablePush(setup)).rejects.toThrow('server unavailable');
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('replaces an existing subscription after the VAPID key changes', async () => {
    const oldSubscription = {
      options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer },
      unsubscribe: vi.fn(async () => true),
    };
    getSubscription.mockResolvedValue(oldSubscription);
    subscribe.mockRejectedValueOnce(new DOMException('Options changed', 'InvalidStateError')).mockResolvedValueOnce(subscription);
    await enablePush(setup);
    expect(oldSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenCalledWith('/api/notifications/push', expect.objectContaining({ method: 'POST' }));
  });

  it('waits for an in-flight activation before revoking its subscription', async () => {
    let finishRegistration!: () => void;
    apiFetch.mockImplementation((_path: string, init?: RequestInit) => init?.method === 'POST'
      ? new Promise((resolve) => { finishRegistration = () => resolve({ ok: true }); })
      : Promise.resolve({ ok: true }));
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn(async () => setup.registration) } });
    const enabling = enablePush(setup);
    await vi.waitFor(() => expect(finishRegistration).toBeTypeOf('function'));
    const disabling = disablePush();
    expect(apiFetch).not.toHaveBeenCalledWith('/api/notifications/push', expect.objectContaining({ method: 'DELETE' }));
    finishRegistration();
    await Promise.all([enabling, disabling]);
    expect(apiFetch).toHaveBeenCalledWith('/api/notifications/push', expect.objectContaining({ method: 'DELETE' }));
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('does not let a pending restoration re-register after disabling', async () => {
    let finishRegistration!: () => void;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.endsWith('/config')) return Promise.resolve({ available: true, publicKey: 'AQID' });
      if (init?.method === 'POST') return new Promise((resolve) => { finishRegistration = () => resolve({ ok: true }); });
      return Promise.resolve({ ok: true });
    });
    stubSupportedBrowser();
    const restoring = restorePush();
    await vi.waitFor(() => expect(finishRegistration).toBeTypeOf('function'));
    const disabling = disablePush();
    finishRegistration();
    await Promise.all([restoring, disabling]);
    expect(apiFetch).toHaveBeenCalledWith('/api/notifications/push', expect.objectContaining({ method: 'DELETE' }));
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
    expect(localStorage.getItem('ss-notifications-enabled')).toBe('0');
  });

  it('renews a stale VAPID subscription when the app reopens', async () => {
    const oldSubscription = {
      options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer },
      unsubscribe: vi.fn(async () => true),
    };
    getSubscription.mockResolvedValue(oldSubscription);
    apiFetch.mockImplementation((path: string) => Promise.resolve(path.endsWith('/config')
      ? { available: true, publicKey: 'AQID' } : { ok: true }));
    stubSupportedBrowser();
    await restorePush();
    expect(oldSubscription.unsubscribe).toHaveBeenCalledOnce();
    expect(subscribe).toHaveBeenCalledOnce();
    expect(apiFetch).toHaveBeenCalledWith('/api/notifications/push', expect.objectContaining({ method: 'POST' }));
  });

  it('stops renewal if notifications are disabled while the old key is being removed', async () => {
    let finishUnsubscribe!: () => void;
    const oldSubscription = {
      options: { applicationServerKey: new Uint8Array([9, 9, 9]).buffer },
      unsubscribe: vi.fn(() => new Promise<boolean>((resolve) => { finishUnsubscribe = () => resolve(true); })),
    };
    getSubscription.mockResolvedValueOnce(oldSubscription).mockResolvedValueOnce(null);
    apiFetch.mockImplementation((path: string) => Promise.resolve(path.endsWith('/config')
      ? { available: true, publicKey: 'AQID' } : { ok: true }));
    stubSupportedBrowser();
    const restoring = restorePush();
    await vi.waitFor(() => expect(oldSubscription.unsubscribe).toHaveBeenCalledOnce());
    const disabling = disablePush();
    finishUnsubscribe();
    await Promise.all([restoring, disabling]);
    expect(subscribe).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalledWith('/api/notifications/push', expect.objectContaining({ method: 'POST' }));
  });
});

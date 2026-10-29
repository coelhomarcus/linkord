import { beforeEach, describe, expect, it, vi } from 'vitest';
import { enablePush, type PushSetup } from '@/shared/pushNotifications';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/api', () => ({ apiFetch }));

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/example',
  keys: { p256dh: 'key', auth: 'auth' },
  unsubscribe: vi.fn(),
};
const subscribe = vi.fn();
const setup = { registration: { pushManager: { subscribe } }, publicKey: new Uint8Array([1, 2, 3]) } as unknown as PushSetup;

beforeEach(() => {
  subscribe.mockReset().mockResolvedValue(subscription);
  subscription.unsubscribe.mockReset().mockResolvedValue(true);
  apiFetch.mockReset().mockResolvedValue({ ok: true });
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
});

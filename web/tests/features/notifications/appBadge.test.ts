import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/shared/api/api';
import { clearAppBadge, refreshAppBadge } from '@/features/notifications/appBadge';

vi.mock('@/shared/api/api', () => ({ apiFetch: vi.fn() }));
const fetchBadge = vi.mocked(apiFetch);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('app icon badge', () => {
  it('uses the server count and clears the icon when nothing remains unread', async () => {
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadgeApi = vi.fn(async () => {});
    vi.stubGlobal('navigator', { setAppBadge, clearAppBadge: clearAppBadgeApi });
    fetchBadge.mockResolvedValueOnce({ count: 7 }).mockResolvedValueOnce({ count: 0 });

    await refreshAppBadge();
    await refreshAppBadge();

    expect(setAppBadge).toHaveBeenCalledWith(7);
    expect(clearAppBadgeApi).toHaveBeenCalledOnce();
    expect(fetchBadge).toHaveBeenCalledWith('/api/notifications/badge', { signal: undefined, cache: 'no-store' });
  });

  it('does not change the icon after an aborted request', async () => {
    const setAppBadge = vi.fn(async () => {});
    vi.stubGlobal('navigator', { setAppBadge });
    const controller = new AbortController();
    fetchBadge.mockImplementationOnce(async () => {
      controller.abort();
      return { count: 8 };
    });

    await refreshAppBadge(controller.signal);

    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it('clears the badge with zero when the clear method is unavailable', async () => {
    const setAppBadge = vi.fn(async () => {});
    vi.stubGlobal('navigator', { setAppBadge });
    await clearAppBadge();
    expect(setAppBadge).toHaveBeenCalledWith(0);
  });
});

describe('app icon badge — in the desktop app', () => {
  afterEach(() => { delete window.linkordDesktop; });

  it('sets the count through the desktop app instead of the Badging API', async () => {
    const setBadgeCount = vi.fn(async () => true);
    window.linkordDesktop = { platform: 'darwin', version: '0.1.0', setBadgeCount };
    const setAppBadge = vi.fn(async () => {});
    vi.stubGlobal('navigator', { setAppBadge });
    fetchBadge.mockResolvedValueOnce({ count: 3 });

    await refreshAppBadge();
    await clearAppBadge();

    expect(setBadgeCount.mock.calls).toEqual([[3], [0]]);
    expect(setAppBadge).not.toHaveBeenCalled();
  });

  it('still badges when the browser has no Badging API, as Electron does', async () => {
    const setBadgeCount = vi.fn(async () => true);
    window.linkordDesktop = { platform: 'linux', version: '0.1.0', setBadgeCount };
    vi.stubGlobal('navigator', {});
    fetchBadge.mockResolvedValueOnce({ count: 1 });

    await refreshAppBadge();

    expect(setBadgeCount).toHaveBeenCalledWith(1);
  });
});

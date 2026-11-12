import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNotificationSettings } from '@/features/notifications/useNotificationSettings';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const muted = (mutedUntil: string | null) => ({ level: null, muted: true, mutedUntil });

describe('useNotificationSettings', () => {
  it('starts from the welcome and follows changes from any tab', () => {
    const { result } = renderHook(() => useNotificationSettings());
    act(() => result.current.onWelcome({ servers: { s1: { level: 'mentions', muted: false, mutedUntil: null } }, conversations: {} }));
    expect(result.current.policyFor({ id: 'c1', serverId: 's1' })).toEqual({ level: 'mentions', muted: false });

    act(() => result.current.onChanged({ t: 'notification-settings', scope: 'conversation', id: 'c1', setting: { level: 'all', muted: false, mutedUntil: null } }));
    expect(result.current.policyFor({ id: 'c1', serverId: 's1' }).level).toBe('all');
    act(() => result.current.onChanged({ t: 'notification-settings', scope: 'server', id: 's1', setting: null }));
    expect(result.current.settings.servers).toEqual({});
  });

  it('an older server sends no settings: nothing is muted', () => {
    const { result } = renderHook(() => useNotificationSettings());
    act(() => result.current.onWelcome(undefined));
    expect(result.current.policyFor({ id: 'dm' })).toEqual({ level: 'all', muted: false });
  });

  it('renders again when a mute runs out', () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-12T12:00:00Z') });
    const { result } = renderHook(() => useNotificationSettings());
    act(() => result.current.onWelcome({ servers: {}, conversations: { dm: muted('2026-11-12T12:15:00Z') } }));
    expect(result.current.policyFor({ id: 'dm' }).muted).toBe(true);
    act(() => { vi.advanceTimersByTime(15 * 60_000 + 100); });
    expect(result.current.policyFor({ id: 'dm' }).muted).toBe(false);
  });

  it("sends a change and applies the server's answer", async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ setting: muted(null) }), { status: 200 }));
    const { result } = renderHook(() => useNotificationSettings());
    await act(() => result.current.update('server', 's1', { mute: 'forever' }));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/notification-settings/servers/s1');
    expect(init).toMatchObject({ method: 'PATCH', body: JSON.stringify({ mute: 'forever' }) });
    expect(result.current.policyNow({ id: 'c9', serverId: 's1' }).muted).toBe(true);
  });
});

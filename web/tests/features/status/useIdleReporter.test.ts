import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useIdleReporter } from '@/features/status/useIdleReporter';
import { setAutoIdleMinutes } from '@/features/status/autoIdlePreference';
import type { ClientMessage } from '@/shared/types/protocol';

let sent: ClientMessage[];
let connected: boolean;
const sendWs = (msg: ClientMessage) => { if (connected) sent.push(msg); return connected; };

beforeEach(() => {
  sent = [];
  connected = true;
  vi.useFakeTimers();
  setAutoIdleMinutes(5);
});

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('useIdleReporter', () => {
  it('reports idle after the minutes set, and active again on the next input', () => {
    renderHook(() => useIdleReporter({ sendWs }));
    act(() => { vi.advanceTimersByTime(4 * 60_000); });
    expect(sent).toEqual([]);
    act(() => { vi.advanceTimersByTime(60_000 + 15_000); });
    expect(sent).toEqual([{ t: 'presence-activity', idle: true }]);

    act(() => { window.dispatchEvent(new Event('keydown')); });
    expect(sent.at(-1)).toEqual({ t: 'presence-activity', idle: false });
    window.dispatchEvent(new Event('pointermove'));
    expect(sent).toHaveLength(2);
  });

  it('never reports idle when turned off', () => {
    setAutoIdleMinutes(0);
    renderHook(() => useIdleReporter({ sendWs }));
    act(() => { vi.advanceTimersByTime(60 * 60_000); });
    expect(sent).toEqual([]);
  });

  it('says idle again on a new connection, which the server starts as active', () => {
    const { result } = renderHook(() => useIdleReporter({ sendWs }));
    act(() => { vi.advanceTimersByTime(6 * 60_000); });
    expect(sent).toHaveLength(1);
    act(() => result.current.onWelcome());
    expect(sent).toEqual([{ t: 'presence-activity', idle: true }, { t: 'presence-activity', idle: true }]);
  });

  it('retries a report lost to a dropped socket', () => {
    connected = false;
    renderHook(() => useIdleReporter({ sendWs }));
    act(() => { vi.advanceTimersByTime(6 * 60_000); });
    expect(sent).toEqual([]);
    connected = true;
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(sent).toEqual([{ t: 'presence-activity', idle: true }]);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  getPreference, getPreferences, receivePreferenceChanges, setPreference, syncAccountPreferences, usePreferenceValue,
} from '@/shared/preferences/accountPreferences';
import { LOCAL_STORAGE_KEYS } from '@/shared/lib/localStorage';

type Call = { url: string; method: string; body: unknown };

let calls: Call[] = [];
let respond: (call: Call) => Response | Promise<Response>;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The server's own merge, enough to answer a PATCH like it would. */
let server: Record<string, unknown> = {};
function serverAnswer(call: Call): Response {
  if (call.url === '/api/me/preferences') {
    for (const [key, value] of Object.entries((call.body as { changes: Record<string, unknown> }).changes)) {
      if (value === null) delete server[key]; else server[key] = value;
    }
  } else {
    server = { ...(call.body as { values: Record<string, unknown> }).values };
  }
  return json(200, { preferences: { ...server } });
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  calls = [];
  server = {};
  respond = serverAnswer;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const call = { url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return respond(call);
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
}

describe('account preferences', () => {
  it('reads what this browser cached before the server answers', () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.preferences, JSON.stringify({ colorTheme: 'mocha', bogus: 1 }));
    expect(getPreferences()).toEqual({ colorTheme: 'mocha' });
  });

  it('gathers what an older build saved under its own keys, once', () => {
    localStorage.setItem('ss-sounds', JSON.stringify({ message: false, call: true }));
    localStorage.setItem('ss-show-tile-banners', '0');
    localStorage.setItem('ss-emoji-skin-tone', '3');
    localStorage.setItem('ss-collapsed-categories:srv1', JSON.stringify(['cat1']));
    localStorage.setItem(LOCAL_STORAGE_KEYS.density, 'compact');
    expect(getPreferences()).toEqual({
      'sounds.message': false, 'sounds.call': true, showTileBanners: false, emojiSkinTone: 3,
      'collapsed:srv1': ['cat1'], density: 'compact',
    });
    expect(localStorage.getItem('ss-sounds')).toBeNull();
    expect(localStorage.getItem('ss-collapsed-categories:srv1')).toBeNull();
    // the boot script still reads it
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.density)).toBe('compact');
  });

  it('applies a change at once and sends only the last one of a burst', async () => {
    await syncAccountPreferences('u1', {});
    calls = [];
    setPreference('callVolume:p1', 0.5);
    setPreference('callVolume:p1', 0.4);
    setPreference('callVolume:p1', 0.3);
    expect(getPreference('callVolume:p1')).toBe(0.3);
    expect(calls).toHaveLength(0);
    await settle();
    expect(calls).toEqual([{ url: '/api/me/preferences', method: 'PATCH', body: { changes: { 'callVolume:p1': 0.3 } } }]);
  });

  it('takes the account over this browser once the server answers', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.preferences, JSON.stringify({ colorTheme: 'mocha' }));
    await syncAccountPreferences('u1', { colorTheme: 'latte', timeFormat: '12h' });
    expect(getPreferences()).toEqual({ colorTheme: 'latte', timeFormat: '12h' });
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.colorTheme)).toBe('latte');
    expect(calls).toHaveLength(0);
  });

  it('seeds an account that never synced with what this browser had', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.preferences, JSON.stringify({ colorTheme: 'mocha' }));
    await syncAccountPreferences('u1', null);
    expect(calls).toEqual([{ url: '/api/me/preferences/seed', method: 'POST', body: { values: { colorTheme: 'mocha' } } }]);
    expect(localStorage.getItem(LOCAL_STORAGE_KEYS.preferencesOwner)).toBe('u1');
    // a later read from before the seed landed does not seed again
    await syncAccountPreferences('u1', null);
    expect(calls).toHaveLength(1);
  });

  it('does not hand one account\'s settings to another signing in on the same browser', async () => {
    localStorage.setItem(LOCAL_STORAGE_KEYS.preferences, JSON.stringify({ 'callVolume:p1': 0.2 }));
    localStorage.setItem(LOCAL_STORAGE_KEYS.preferencesOwner, 'u1');
    await syncAccountPreferences('u2', null);
    expect(calls[0]?.body).toEqual({ values: {} });
    expect(getPreferences()).toEqual({});
  });

  it('hears changes from other tabs and re-renders their readers', async () => {
    await syncAccountPreferences('u1', {});
    const { result } = renderHook(() => usePreferenceValue(() => getPreference('timeFormat') ?? 'auto'));
    act(() => receivePreferenceChanges({ timeFormat: '24h' }));
    expect(result.current).toBe('24h');
    act(() => receivePreferenceChanges({ timeFormat: null }));
    expect(result.current).toBe('auto');
  });

  it('keeps a value this tab changed again over an echo of an older one', async () => {
    await syncAccountPreferences('u1', {});
    setPreference('density', 'compact');
    receivePreferenceChanges({ density: 'comfortable' });
    expect(getPreference('density')).toBe('compact');
    await settle();
    expect(getPreference('density')).toBe('compact');
  });

  it('keeps what the server could not get and sends it after the next welcome', async () => {
    await syncAccountPreferences('u1', {});
    respond = () => { throw new TypeError('offline'); };
    setPreference('font', 'system');
    await settle();
    expect(getPreference('font')).toBe('system');
    respond = serverAnswer;
    calls = [];
    await act(() => syncAccountPreferences('u1', {}));
    await settle();
    expect(calls.map((c) => c.body)).toEqual([{ changes: { font: 'system' } }]);
    expect(server).toEqual({ font: 'system' });
  });

  it('puts back what the account had when the server refuses a change', async () => {
    await syncAccountPreferences('u1', { colorTheme: 'latte' });
    respond = () => json(400, { error: { code: 'invalid_request', message: 'x' } });
    setPreference('colorTheme', 'mocha');
    expect(getPreference('colorTheme')).toBe('mocha');
    await settle();
    expect(getPreference('colorTheme')).toBe('latte');
  });

  it('never sends a value the server would refuse', async () => {
    await syncAccountPreferences('u1', {});
    setPreference('emojiSkinTone', 9);
    setPreference('nope', true);
    await settle();
    expect(calls).toHaveLength(0);
    expect(getPreferences()).toEqual({});
  });
});

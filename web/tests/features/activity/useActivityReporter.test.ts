import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useActivityReporter } from '@/features/activity/useActivityReporter';
import type { DesktopActivity, DesktopActivityApi } from '@/shared/desktop';
import type { ActivitySettings, ClientMessage } from '@/shared/types/protocol';

const lookup = vi.hoisted(() => vi.fn());
const upload = vi.hoisted(() => vi.fn());
vi.mock('@/features/activity/activityApi', () => ({ lookupActivityGame: lookup, uploadActivityIcon: upload }));

function stubDesktop(initial: DesktopActivity | null) {
  let listener: ((activity: DesktopActivity | null) => void) | null = null;
  const api = {
    watch: vi.fn(async () => {}),
    current: vi.fn(async () => initial),
    recent: vi.fn(async () => []),
    icon: vi.fn(async () => 'data:image/png;base64,AAAA'),
    onChange: vi.fn((callback: (activity: DesktopActivity | null) => void) => {
      listener = callback;
      return () => { listener = null; };
    }),
  } satisfies DesktopActivityApi;
  window.linkordDesktop = { platform: 'win32', version: '0.3.0', activity: api };
  return { api, change: (activity: DesktopActivity | null) => act(() => listener?.(activity)) };
}

const minecraft: DesktopActivity = { key: 'minecraft', kind: 'playing', name: 'Minecraft', startedAt: 1000 };
const spotify: DesktopActivity = { key: 'spotify', kind: 'using', name: 'Spotify', startedAt: 2000 };

function render(settings: ActivitySettings = { sharing: true, hidden: [] }) {
  const sent: ClientMessage[] = [];
  const sendWs = vi.fn((msg: ClientMessage) => { sent.push(msg); return true; });
  const hook = renderHook(({ s }) => useActivityReporter({ sendWs, settings: s }), { initialProps: { s: settings } });
  const reports = () => sent.filter((m): m is Extract<ClientMessage, { t: 'activity-set' }> => m.t === 'activity-set').map((m) => m.activity);
  return { ...hook, reports };
}

beforeEach(() => {
  localStorage.clear();
  lookup.mockReset();
  upload.mockReset();
});

afterEach(() => { delete window.linkordDesktop; });

describe('useActivityReporter', () => {
  it('sends a detected game with its IGDB cover', async () => {
    stubDesktop(minecraft);
    lookup.mockResolvedValue({ name: 'Minecraft', image: 'co49x5' });
    const { reports } = render();
    await waitFor(() => expect(reports().at(-1)).toEqual({ key: 'minecraft', kind: 'playing', name: 'Minecraft', icon: { igdb: 'co49x5' }, startedAt: 1000 }));
    expect(upload).not.toHaveBeenCalled();
  });

  it('sends an app with its own icon, uploaded once', async () => {
    const { change } = stubDesktop(null);
    upload.mockResolvedValue('a'.repeat(64));
    const { reports } = render();
    change(spotify);
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ key: 'spotify', icon: { local: 'a'.repeat(64) } }));
    change(null);
    change(spotify);
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ key: 'spotify' }));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('names a Steam game the desktop app could not name from the lookup', async () => {
    stubDesktop({ key: 'steam:570', kind: 'playing', name: '', steamAppId: 570, startedAt: 1 });
    lookup.mockResolvedValue({ name: 'Dota 2', image: null });
    upload.mockResolvedValue(null);
    const { reports } = render();
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ key: 'steam:570', name: 'Dota 2', icon: null }));
    expect(lookup).toHaveBeenCalledWith({ steamAppId: 570, name: '' });
  });

  it('sends nothing for a hidden activity, and the activity again once shown', async () => {
    stubDesktop(minecraft);
    lookup.mockResolvedValue({ name: 'Minecraft', image: 'co1' });
    const { reports, rerender } = render({ sharing: true, hidden: ['minecraft'] });
    await waitFor(() => expect(reports().length).toBeGreaterThan(0));
    expect(reports().at(-1)).toBeNull();
    rerender({ s: { sharing: true, hidden: [] } });
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ key: 'minecraft' }));
  });

  it('stops detection and clears the activity when sharing is turned off', async () => {
    const { api } = stubDesktop(minecraft);
    lookup.mockResolvedValue({ name: 'Minecraft', image: 'co1' });
    const { reports, rerender } = render();
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ key: 'minecraft' }));
    rerender({ s: { sharing: false, hidden: [] } });
    expect(api.watch).toHaveBeenLastCalledWith(false);
    expect(reports().at(-1)).toBeNull();
  });

  it('does nothing in a browser', () => {
    const { reports } = render();
    expect(reports()).toEqual([]);
  });
});

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
    setHidden: vi.fn(async (_keys: string[]) => {}),
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
  upload.mockResolvedValue(null);
});

afterEach(() => { delete window.linkordDesktop; });

describe('useActivityReporter', () => {
  it('sends a detected game with the icon the server picked by the program\'s own', async () => {
    stubDesktop(minecraft);
    upload.mockResolvedValue('c'.repeat(64));
    lookup.mockResolvedValue({ name: 'Minecraft', image: 'co49x5', icon: 'b'.repeat(64) });
    const { reports } = render();
    await waitFor(() => expect(reports().at(-1)).toEqual({ key: 'minecraft', kind: 'playing', name: 'Minecraft', icon: { local: 'b'.repeat(64) }, startedAt: 1000, sentAt: expect.any(Number) }));
    expect(lookup).toHaveBeenCalledWith({ steamAppId: undefined, name: 'Minecraft', ref: 'c'.repeat(64) });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('falls back to the program\'s own icon for a game without one, never to the cover', async () => {
    stubDesktop(minecraft);
    lookup.mockResolvedValue({ name: 'Minecraft', image: 'co49x5', icon: null });
    upload.mockResolvedValue('c'.repeat(64));
    const { reports } = render();
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ key: 'minecraft', icon: { local: 'c'.repeat(64) } }));
  });

  it('asks the server for a game\'s icon every time it starts, sending the same program icon once', async () => {
    const { change } = stubDesktop(null);
    upload.mockResolvedValue('c'.repeat(64));
    lookup.mockResolvedValueOnce({ name: 'Minecraft', icon: 'b'.repeat(64) }).mockResolvedValueOnce({ name: 'Minecraft', icon: 'd'.repeat(64) });
    const { reports } = render();
    change(minecraft);
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ icon: { local: 'b'.repeat(64) } }));
    change(null);
    change(minecraft);
    // a better pick on the server shows on the next game
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ icon: { local: 'd'.repeat(64) } }));
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenLastCalledWith({ steamAppId: undefined, name: 'Minecraft', ref: 'c'.repeat(64) });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('sends a program icon again once its picture changes, and drops what older versions kept', async () => {
    localStorage.setItem('ss-activity-icons-v2', JSON.stringify({ minecraft: { local: 'f'.repeat(64) } }));
    const { api, change } = stubDesktop(null);
    upload.mockResolvedValueOnce('1'.repeat(64)).mockResolvedValueOnce('2'.repeat(64));
    const { reports } = render();
    change(spotify);
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ icon: { local: '1'.repeat(64) } }));
    expect(localStorage.getItem('ss-activity-icons-v2')).toBeNull();
    api.icon.mockResolvedValue('data:image/png;base64,BBBB');
    change(null);
    change(spotify);
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ icon: { local: '2'.repeat(64) } }));
    expect(upload).toHaveBeenCalledTimes(2);
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
    lookup.mockResolvedValue({ name: 'Dota 2', image: null, icon: null });
    upload.mockResolvedValue(null);
    const { reports } = render();
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ key: 'steam:570', name: 'Dota 2', icon: null }));
    expect(lookup).toHaveBeenCalledWith({ steamAppId: 570, name: '', ref: null });
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

  it('sends each report with the time it left, on the same clock as the start', async () => {
    stubDesktop(spotify);
    upload.mockResolvedValue(null);
    const before = Date.now();
    const { reports } = render();
    await waitFor(() => expect(reports().at(-1)).toMatchObject({ key: 'spotify', startedAt: 2000 }));
    const { sentAt } = reports().at(-1) as { sentAt: number };
    expect(sentAt).toBeGreaterThanOrEqual(before);
    expect(sentAt).toBeLessThanOrEqual(Date.now());
  });

  it('tells the desktop app which activities are hidden, so it picks another one', async () => {
    const { api } = stubDesktop(null);
    const { rerender } = render({ sharing: true, hidden: ['spotify'] });
    expect(api.setHidden).toHaveBeenLastCalledWith(['spotify']);
    rerender({ s: { sharing: true, hidden: [] } });
    await waitFor(() => expect(api.setHidden).toHaveBeenLastCalledWith([]));
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

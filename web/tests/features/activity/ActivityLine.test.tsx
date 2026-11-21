import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { UserActivityCard, UserActivityInline } from '@/features/activity/ActivityLine';
import { syncServerClock } from '@/features/activity/serverClock';
import type { Activity, VisiblePresence } from '@/shared/types/protocol';

const activity: Activity = { key: 'minecraft', kind: 'playing', name: 'Minecraft', icon: `/api/activity/icons/${'a'.repeat(64)}.webp`, startedAt: new Date(Date.now() - 25 * 60_000).toISOString() };

function renderFor(ui: React.ReactElement, presence: Record<string, VisiblePresence>, online: string[]) {
  return renderWithRoom(ui, {
    state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } },
    presenceByUser: new Map(Object.entries(presence)),
    onlineUserIds: new Set(online),
  });
}

describe('activity display', () => {
  afterEach(() => {
    syncServerClock(Date.now());
    vi.useRealTimers();
  });

  it('shows what someone online is playing, with its icon and for how long', () => {
    const { container } = renderFor(<UserActivityCard userId="ana" />, { ana: { status: 'online', customStatus: null, activity } }, ['ana']);
    const card = screen.getByRole('region', { name: 'Jogando Minecraft' });
    expect(card).toHaveTextContent('Minecraft');
    // the green gamepad and the time it has run, as a stopwatch
    expect(screen.getByRole('timer', { name: /^Jogando há 25:0\d$/ })).toBeInTheDocument();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(activity.icon);
  });

  it('keeps the timer running while it shows', () => {
    vi.useFakeTimers({ now: new Date('2026-11-16T12:00:00Z') });
    const started = { ...activity, startedAt: new Date(Date.now() - (41 * 60 + 27) * 1000).toISOString() };
    renderFor(<UserActivityCard userId="ana" />, { ana: { status: 'online', customStatus: null, activity: started } }, ['ana']);
    expect(screen.getByRole('timer')).toHaveTextContent('41:27');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole('timer')).toHaveTextContent('41:28');
  });

  it('counts on the server\'s clock when this device\'s clock is hours off', () => {
    vi.useFakeTimers({ now: new Date('2026-11-16T12:00:00Z') });
    const justStarted = { ...activity, startedAt: new Date(Date.now() - 42_000).toISOString() };
    // this device reads 15:00 while the server reads 12:00, as a dual-boot PC three hours off does
    vi.setSystemTime(new Date('2026-11-16T15:00:00Z'));
    syncServerClock(new Date('2026-11-16T12:00:00Z').getTime());
    renderFor(<UserActivityCard userId="ana" />, { ana: { status: 'online', customStatus: null, activity: justStarted } }, ['ana']);
    expect(screen.getByRole('timer')).toHaveTextContent('0:42');
  });

  it('reads as one line under a name', () => {
    renderFor(<UserActivityInline userId="ana" />, { ana: { status: 'online', customStatus: null, activity: { ...activity, kind: 'using', name: 'Spotify' } } }, ['ana']);
    expect(screen.getByText('Spotify').closest('span')).toHaveTextContent('Usando Spotify');
  });

  it('shows nothing for someone offline or without an activity', () => {
    const { container } = renderFor(<><UserActivityCard userId="ana" /><UserActivityCard userId="bia" /></>, { ana: { status: 'online', customStatus: null, activity } }, []);
    expect(container).toBeEmptyDOMElement();
  });
});

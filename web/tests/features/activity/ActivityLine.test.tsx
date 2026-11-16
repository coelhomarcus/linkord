import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { UserActivityCard, UserActivityInline } from '@/features/activity/ActivityLine';
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
  it('shows what someone online is playing, with its icon and for how long', () => {
    const { container } = renderFor(<UserActivityCard userId="ana" />, { ana: { status: 'online', customStatus: null, activity } }, ['ana']);
    expect(screen.getByRole('region', { name: 'Jogando Minecraft' })).toBeInTheDocument();
    expect(screen.getByText('há 25 minutos')).toBeInTheDocument();
    expect(container.querySelector('img')?.getAttribute('src')).toBe(activity.icon);
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

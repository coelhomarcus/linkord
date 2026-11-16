import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';
import { ProfileActivity } from '@/features/activity/ProfileActivity';
import * as activityApi from '@/features/activity/activityApi';
import { initialRoomState } from '@/state/roomReducer';
import type { Activity, VisiblePresence } from '@/shared/types/protocol';

vi.mock('@/features/activity/activityApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/activity/activityApi')>()),
  fetchActivityHistory: vi.fn(),
}));
const fetchHistory = vi.mocked(activityApi.fetchActivityHistory);

const NOW = new Date('2026-11-16T12:00:00Z').getTime();
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const fortnite: Activity = { key: 'fortnite', kind: 'playing', name: 'Fortnite', icon: null, startedAt: ago(HOUR + 19 * 60_000 + 35_000) };

function renderTab(presence: Record<string, VisiblePresence> = {}) {
  return renderWithRoom(<ProfileActivity userId="ana" name="Ana" />, {
    state: { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } },
    presenceByUser: new Map(Object.entries(presence)),
    onlineUserIds: new Set(Object.keys(presence)),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
  fetchHistory.mockReset().mockResolvedValue({
    sharing: true,
    items: [
      { key: 'fortnite', kind: 'playing', name: 'Fortnite', icon: null, lastPlayedAt: ago(3 * HOUR) },
      { key: 'dbd', kind: 'playing', name: 'Dead by Daylight', icon: null, lastPlayedAt: ago(HOUR) },
      { key: 'roblox', kind: 'playing', name: 'Roblox', icon: null, lastPlayedAt: ago(2 * 24 * HOUR) },
      { key: 'minecraft', kind: 'playing', name: 'Minecraft', icon: null, lastPlayedAt: ago(15 * 24 * HOUR) },
    ],
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('the profile Activity tab', () => {
  it('shows what they are doing now, large, with its timer, and the rest by when it was last played', async () => {
    renderTab({ ana: { status: 'online', customStatus: null, activity: fortnite } });
    const current = screen.getByRole('region', { name: 'Atividade atual' });
    expect(within(current).getByText('Fortnite')).toBeInTheDocument();
    expect(within(current).getByRole('timer')).toHaveTextContent('1:19:35');

    const recent = screen.getByRole('region', { name: 'Atividade recente' });
    const rows = await within(recent).findAllByRole('listitem');
    // the game being played now is not repeated below
    expect(rows.map((row) => row.textContent)).toEqual([
      'Dead by DaylightJogando, 1h atrás', 'RobloxJogando, 2d atrás', 'MinecraftJogando, Há 2 sem.',
    ]);
    expect(fetchHistory).toHaveBeenCalledWith('ana', expect.any(AbortSignal));
  });

  it('shows only the recent list when nothing is running', async () => {
    renderTab();
    expect(screen.queryByRole('region', { name: 'Atividade atual' })).not.toBeInTheDocument();
    expect(await screen.findByText('Fortnite')).toBeInTheDocument();
  });

  it('says so when they do not share their activity, or have none yet', async () => {
    fetchHistory.mockResolvedValueOnce({ sharing: false, items: [] });
    const { unmount } = renderTab();
    expect(await screen.findByText('Ana não compartilha a atividade.')).toBeInTheDocument();
    unmount();
  });

  it('offers to try again when the history cannot be read', async () => {
    fetchHistory.mockRejectedValueOnce(new Error('down'));
    renderTab();
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar a atividade.');
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Dead by Daylight')).toBeInTheDocument();
  });

  describe('in English', () => {
    useLanguageForTests('en-US');
    it('reads the times in English', async () => {
      renderTab();
      expect(await screen.findByText('2d ago')).toBeInTheDocument();
      expect(screen.getByText('2w ago')).toBeInTheDocument();
    });
  });
});

import type { ActivityHistoryItem } from '@/features/activity/activityApi';
import type { GameItem, GameWidgetType } from '@/features/games/types';
export type ConnectionProvider = 'url' | 'myanimelist' | 'github' | 'steam' | 'twitch';
export const WIDGET_TYPES = {
  myanimelist: ['mal-recent-anime'],
  github: ['github-profile', 'github-calendar'],
  steam: ['steam-recent', 'steam-top', 'steam-profile'],
  twitch: ['twitch-live', 'twitch-vods'],
  url: [],
} as const;
type ConnectionWidgetType = (typeof WIDGET_TYPES)[ConnectionProvider][number];
export type WidgetType = ConnectionWidgetType | GameWidgetType | ActivityWidgetType;
interface MediaItem {
  id: string; title: string; url: string; imageUrl: string | null;
}
type CalendarDay = { date: string; count: number; level: number };
type ActivityWidgetType = 'activity-top' | 'activity-recent' | 'activity-summary';
export type ActivityPeriod = 7 | 30;
export const connectionInputLength = { url: 300, steam: 300, myanimelist: 16, github: 39, twitch: 25 } satisfies Record<ConnectionProvider, number>;
export function isActivityWidget(type: WidgetType): type is ActivityWidgetType {
  return type.startsWith('activity-');
}
export type WidgetData =
  | { kind: 'list'; items: MediaItem[] }
  | { kind: 'games'; items: GameItem[] }
  | { kind: 'github-profile'; login: string; name: string | null; avatarUrl: string | null; repositories: number; followers: number; following: number }
  | { kind: 'github-calendar'; total: number; days: CalendarDay[] }
  | { kind: 'activity-top'; items: Array<Omit<ActivityHistoryItem, 'lastPlayedAt'> & { milliseconds: number }> }
  | { kind: 'activity-recent'; items: ActivityHistoryItem[] }
  | { kind: 'activity-summary'; total: number; longestStreak: number; favorite: string | null }
  | { kind: 'steam-games'; items: Array<MediaItem & { minutes: number }> }
  | { kind: 'steam-profile'; name: string; avatarUrl: string | null; level: number; owned: number; currentGame: string | null }
  | { kind: 'twitch-live'; login: string; name: string; avatarUrl: string | null; lastStreamAt: string | null;
      stream: { title: string; game: string | null; viewers: number; imageUrl: string | null } | null; status: 'live' | 'offline' | 'unknown' }
  | { kind: 'twitch-vods'; items: Array<MediaItem & { createdAt: string; seconds: number }> };
/** Games and activity widgets have no connected account. */
export interface WallSelection { connectionId: string | null; type: WidgetType; period?: ActivityPeriod }

export interface ProfileConnection {
  id: string; provider: ConnectionProvider; value: string; url: string; position: number;
  /** off: still yours, but left out of your profile's links and Wall */
  showOnProfile: boolean;
  syncedAt: string | null; syncError: string | null; status: 'ready' | 'pending' | 'error';
}
export interface ConnectionsResponse { connections: ProfileConnection[]; providers?: ConnectionProvider[] }
export interface WallWidget { connection: ProfileConnection | null; type: WidgetType; data: WidgetData | null; period?: ActivityPeriod; periods?: Record<ActivityPeriod, WidgetData | null>; hidden?: boolean }
export interface WallResponse { widgets: WallWidget[]; available?: WallWidget[]; providers?: ConnectionProvider[] }

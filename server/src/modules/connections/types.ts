import type { ActivityHistoryItem } from '../activity/activityHistory.js';
import type { GameItem, GameWidgetType } from '../games/types.js';
export type ConnectionProvider = 'url' | 'myanimelist' | 'github' | 'steam' | 'twitch';
export const WIDGET_TYPES = {
  myanimelist: ['mal-recent-anime'],
  github: ['github-profile', 'github-calendar'],
  steam: ['steam-recent', 'steam-top', 'steam-profile'],
  twitch: ['twitch-live', 'twitch-vods'],
  url: [],
} as const;
export type ConnectionWidgetType = (typeof WIDGET_TYPES)[ConnectionProvider][number];
/** Games and activity widgets have no external connection. */
export type WidgetType = ConnectionWidgetType | GameWidgetType | ActivityWidgetType;
export interface MediaItem {
  id: string; title: string; url: string; imageUrl: string | null;
}
interface CalendarDay { date: string; count: number; level: number }
export type WidgetData =
  | { kind: 'list'; items: MediaItem[] }
  | { kind: 'games'; items: GameItem[] }
  | { kind: 'github-profile'; login: string; name: string | null; avatarUrl: string | null; repositories: number; followers: number; following: number }
  | { kind: 'github-calendar'; total: number; days: CalendarDay[] }
  | { kind: 'activity-top'; items: Array<Omit<ActivityHistoryItem, 'lastPlayedAt'> & { milliseconds: number }> }
  | { kind: 'activity-recent'; items: ActivityHistoryItem[] }
  | { kind: 'activity-summary'; total: number; longestStreak: number; favorite: string | null }
  | { kind: 'steam-games'; items: SteamGame[] }
  | { kind: 'steam-profile'; name: string; avatarUrl: string | null; level: number; owned: number; currentGame: string | null;
      /** absent in a snapshot synced before the mini profile was drawn */
      items?: SteamProfileItems }
  | { kind: 'twitch-live'; login: string; name: string; avatarUrl: string | null; lastStreamAt: string | null;
      stream: TwitchStream | null; status: 'live' | 'offline' | 'unknown';
      /** the channel's offline banner; absent in a snapshot synced before it was read */
      offlineImageUrl?: string | null }
  | { kind: 'twitch-vods'; items: TwitchVideo[] };
export interface ConnectionSnapshot {
  widgets: Partial<Record<ConnectionWidgetType, WidgetData>>;
  steamVisibilityVerified?: true;
  steamProfileHandle?: string;
}
export interface WallSelection { connectionId: string | null; type: WidgetType; period?: ActivityPeriod }

export const ACTIVITY_WIDGET_TYPES = ['activity-top', 'activity-recent', 'activity-summary'] as const;
export type ActivityWidgetType = (typeof ACTIVITY_WIDGET_TYPES)[number];
export type ActivityPeriod = 7 | 30;
export function isActivityWidget(type: string): type is ActivityWidgetType {
  return (ACTIVITY_WIDGET_TYPES as readonly string[]).includes(type);
}
export function hasActivityPeriod(type: WidgetType): boolean {
  return type === 'activity-top' || type === 'activity-summary';
}

export interface SteamGame extends MediaItem { minutes: number }
/** What the profile has equipped from the Points Shop, drawn as Steam's mini profile. */
export interface SteamProfileItems {
  /** the mini profile background: a still picture and the loop Steam plays over it */
  background: { imageUrl: string | null; webmUrl: string | null; mp4Url: string | null } | null;
  avatarFrameUrl: string | null;
  animatedAvatarUrl: string | null;
}
export interface TwitchStream { title: string; game: string | null; viewers: number; imageUrl: string | null }
export interface TwitchVideo extends MediaItem { createdAt: string; seconds: number }

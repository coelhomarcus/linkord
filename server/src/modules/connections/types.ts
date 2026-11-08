import type { GameItem, GameWidgetType } from '../games/types.js';
export type ConnectionProvider = 'url' | 'myanimelist' | 'github';
export const WIDGET_TYPES = {
  myanimelist: ['mal-recent-anime'],
  github: ['github-profile', 'github-calendar'],
  url: [],
} as const;
export type ConnectionWidgetType = (typeof WIDGET_TYPES)[ConnectionProvider][number];
/** The games widgets belong to no connection: their data is the owner's own picks. */
export type WidgetType = ConnectionWidgetType | GameWidgetType;
export interface MediaItem {
  id: string; title: string; url: string; imageUrl: string | null;
}
export type WidgetData =
  | { kind: 'list'; items: MediaItem[] }
  | { kind: 'games'; items: GameItem[] }
  | { kind: 'github-profile'; login: string; name: string | null; avatarUrl: string | null; repositories: number; followers: number; following: number }
  | { kind: 'github-calendar'; total: number; days: { date: string; count: number; level: number }[] };
export interface ConnectionSnapshot { widgets: Partial<Record<ConnectionWidgetType, WidgetData>> }
export interface WallSelection { connectionId: string | null; type: WidgetType }

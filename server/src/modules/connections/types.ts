export type ConnectionProvider = 'url' | 'myanimelist' | 'github';
export const WIDGET_TYPES = {
  myanimelist: ['mal-recent-anime'],
  github: ['github-profile', 'github-calendar'],
  url: [],
} as const;
export type WidgetType = (typeof WIDGET_TYPES)[ConnectionProvider][number];
export interface MediaItem {
  id: string; title: string; url: string; imageUrl: string | null;
}
export type WidgetData =
  | { kind: 'list'; items: MediaItem[] }
  | { kind: 'github-profile'; login: string; name: string | null; avatarUrl: string | null; repositories: number; followers: number; following: number }
  | { kind: 'github-calendar'; total: number; days: { date: string; count: number; level: number }[] };
export interface ConnectionSnapshot { widgets: Partial<Record<WidgetType, WidgetData>> }
export interface WallSelection { connectionId: string; type: WidgetType }

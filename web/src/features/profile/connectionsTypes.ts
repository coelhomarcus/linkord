import type { GameItem, GameWidgetType } from '@/features/games/types';
export type ConnectionProvider = 'url' | 'myanimelist' | 'github';
export const WIDGET_TYPES = {
  myanimelist: ['mal-recent-anime'],
  github: ['github-profile', 'github-calendar'],
  url: [],
} as const;
type ConnectionWidgetType = (typeof WIDGET_TYPES)[ConnectionProvider][number];
export type WidgetType = ConnectionWidgetType | GameWidgetType;
interface MediaItem {
  id: string; title: string; url: string; imageUrl: string | null;
}
type WidgetData =
  | { kind: 'list'; items: MediaItem[] }
  | { kind: 'games'; items: GameItem[] }
  | { kind: 'github-profile'; login: string; name: string | null; avatarUrl: string | null; repositories: number; followers: number; following: number }
  | { kind: 'github-calendar'; total: number; days: { date: string; count: number; level: number }[] };
/** `connectionId` is null for the games widgets, which have no connected account. */
export interface WallSelection { connectionId: string | null; type: WidgetType }

export interface ProfileConnection {
  id: string; provider: ConnectionProvider; value: string; url: string; position: number;
  /** off: still yours, but left out of your profile's links and Wall */
  showOnProfile: boolean;
  syncedAt: string | null; syncError: string | null; status: 'ready' | 'pending' | 'error';
}
export interface ConnectionsResponse { connections: ProfileConnection[] }
export interface WallWidget { connection: ProfileConnection | null; type: WidgetType; data: WidgetData | null }
export interface WallResponse { widgets: WallWidget[]; available?: WallWidget[] }

import { apiFetch } from '@/shared/api/api';

/** A detected game's IGDB name and stored icon id (server/src/modules/activity/), `icon` absent from a
 * server before game icons; for an app (`kind: 'using'`), its icon and the name as sent. `ref` is the
 * program's own icon, stored, which the server picks the icon by. */
export function lookupActivityGame(query: { kind?: 'playing' | 'using'; steamAppId?: number; name: string; ref?: string | null }): Promise<{ name: string; icon?: string | null }> {
  const params = new URLSearchParams();
  if (query.kind === 'using') params.set('kind', 'using');
  if (query.steamAppId) params.set('steam', String(query.steamAppId));
  if (query.name) params.set('name', query.name);
  if (query.ref) params.set('ref', query.ref);
  return apiFetch(`/api/activity/game?${params}`);
}

/** A game's Discord application name and icon, and its Rich Presence images, each stored on the server
 * (`POST /api/activity/discord`); null for whatever Discord does not know. */
export function lookupDiscordActivity(query: { appId: string; images: string[] }): Promise<{ name: string | null; icon: string | null; images: Record<string, string | null> }> {
  return apiFetch('/api/activity/discord', { method: 'POST', body: JSON.stringify(query) });
}

/** Stores a program's own icon (a data URL from the desktop app) and returns its id. */
export async function uploadActivityIcon(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const { id } = await apiFetch<{ id: string }>('/api/activity/icons', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'image/png' } });
  return id;
}

/** One game or app from someone's history (`GET /api/users/:userId/activity`). */
export interface ActivityHistoryItem {
  key: string;
  kind: 'playing' | 'using';
  name: string;
  icon: string | null;
  /** ISO time they were last seen with it */
  lastPlayedAt: string;
}

/** Every game and app kept for this account, hidden ones too, with the icons others see them with
 * (`GET /api/activity/history`): the icons of its activity settings. */
export function fetchOwnActivityHistory(signal?: AbortSignal): Promise<{ items: ActivityHistoryItem[] }> {
  return apiFetch('/api/activity/history', { signal });
}

/** What someone played or used lately, newest first; empty with `sharing: false` while they do not share it. */
export function fetchActivityHistory(userId: string, signal?: AbortSignal): Promise<{ sharing: boolean; items: ActivityHistoryItem[] }> {
  return apiFetch(`/api/users/${encodeURIComponent(userId)}/activity`, { signal });
}

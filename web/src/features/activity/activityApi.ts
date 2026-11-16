import { apiFetch } from '@/shared/api/api';

/** The IGDB name and cover of a detected game (server/src/modules/activity/activityGames.ts). */
export function lookupActivityGame(query: { steamAppId?: number; name: string }): Promise<{ name: string; image: string | null }> {
  const params = new URLSearchParams();
  if (query.steamAppId) params.set('steam', String(query.steamAppId));
  if (query.name) params.set('name', query.name);
  return apiFetch(`/api/activity/game?${params}`);
}

/** Stores a program's own icon (a data URL from the desktop app) and returns its id. */
export async function uploadActivityIcon(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const { id } = await apiFetch<{ id: string }>('/api/activity/icons', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'image/png' } });
  return id;
}

import { apiFetch } from '@/shared/api/api';

/** A detected game's IGDB name and stored icon id (server/src/modules/activity/), `icon` absent from a
 * server before game icons. `ref` is the program's own icon, stored, which the server picks the icon by. */
export function lookupActivityGame(query: { steamAppId?: number; name: string; ref?: string | null }): Promise<{ name: string; icon?: string | null }> {
  const params = new URLSearchParams();
  if (query.steamAppId) params.set('steam', String(query.steamAppId));
  if (query.name) params.set('name', query.name);
  if (query.ref) params.set('ref', query.ref);
  return apiFetch(`/api/activity/game?${params}`);
}

/** Stores a program's own icon (a data URL from the desktop app) and returns its id. */
export async function uploadActivityIcon(dataUrl: string): Promise<string> {
  const blob = await (await fetch(dataUrl)).blob();
  const { id } = await apiFetch<{ id: string }>('/api/activity/icons', { method: 'POST', body: blob, headers: { 'Content-Type': blob.type || 'image/png' } });
  return id;
}

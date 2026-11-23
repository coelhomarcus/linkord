import { apiFetch } from '@/shared/api/api';
import { gameSnapshot, type GameLists } from '@/features/games/types';
import type { ConnectionProvider, ConnectionsResponse, WallResponse, WallSelection } from './connectionsTypes';

export function fetchConnections(signal?: AbortSignal) { return apiFetch<ConnectionsResponse>('/api/me/connections?catalog=2', { signal }); }
export function createConnection(provider: ConnectionProvider, value: string) {
  return apiFetch<ConnectionsResponse>('/api/me/connections?catalog=2', { method: 'POST', body: JSON.stringify({ provider, value }) });
}
export function editConnection(id: string, value: string) {
  return apiFetch<ConnectionsResponse>(`/api/me/connections/${encodeURIComponent(id)}?catalog=2`, { method: 'PATCH', body: JSON.stringify({ value }) });
}
export function setConnectionVisibility(id: string, showOnProfile: boolean) {
  return apiFetch<ConnectionsResponse>(`/api/me/connections/${encodeURIComponent(id)}?catalog=2`, { method: 'PATCH', body: JSON.stringify({ showOnProfile }) });
}
export function deleteConnection(id: string) {
  return apiFetch<ConnectionsResponse>(`/api/me/connections/${encodeURIComponent(id)}?catalog=2`, { method: 'DELETE' });
}
export function fetchWall(userId: string, owner: boolean, signal?: AbortSignal) {
  return apiFetch<WallResponse>(owner ? '/api/me/wall?catalog=2' : `/api/users/${encodeURIComponent(userId)}/wall?catalog=2`, { signal });
}
/** `games` holds only the lists that were edited: the others stay as they are on the server. */
export function saveWall(widgets: WallSelection[], games?: Partial<GameLists>) {
  const lists = games && Object.fromEntries(Object.entries(games).map(([list, items]) => [list, items.map(gameSnapshot)]));
  return apiFetch<WallResponse>('/api/me/wall?catalog=2', { method: 'PUT', body: JSON.stringify(lists ? { widgets, games: lists } : { widgets }) });
}

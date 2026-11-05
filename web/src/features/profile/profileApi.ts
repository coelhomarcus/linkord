import { apiFetch } from '@/shared/api/api';
import type { ConnectionProvider, ConnectionsResponse, WallResponse, WallSelection } from './connectionsTypes';

export function fetchConnections(signal?: AbortSignal) { return apiFetch<ConnectionsResponse>('/api/me/connections', { signal }); }
export function createConnection(provider: ConnectionProvider, value: string) {
  return apiFetch<ConnectionsResponse>('/api/me/connections', { method: 'POST', body: JSON.stringify({ provider, value }) });
}
export function editConnection(id: string, value: string) {
  return apiFetch<ConnectionsResponse>(`/api/me/connections/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ value }) });
}
export function deleteConnection(id: string) {
  return apiFetch<ConnectionsResponse>(`/api/me/connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export function fetchWall(userId: string, owner: boolean, signal?: AbortSignal) {
  return apiFetch<WallResponse>(owner ? '/api/me/wall' : `/api/users/${encodeURIComponent(userId)}/wall`, { signal });
}
export function saveWall(widgets: WallSelection[]) {
  return apiFetch<WallResponse>('/api/me/wall', { method: 'PUT', body: JSON.stringify({ widgets }) });
}

import { apiFetch } from '@/shared/api/api';

/** Whether push notifications include the message text. Kept on the account because the server writes the push. */
export function fetchPushShowContent(): Promise<{ showContent: boolean }> {
  return apiFetch('/api/notifications/push/preferences');
}

export function updatePushShowContent(showContent: boolean): Promise<{ showContent: boolean }> {
  return apiFetch('/api/notifications/push/preferences', { method: 'PATCH', body: JSON.stringify({ showContent }) });
}

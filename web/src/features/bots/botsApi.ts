import { apiFetch } from '@/shared/api/api';
import type { InviteResult } from '@/shared/api/api';

// Client for /api/bots/* — a bot's own lifecycle. Inviting, renaming, leaving
// and deleting a bot go through the same calls a group uses.

/** The webhook's credential: the server only ever shows it right after
 * creating the bot or rotating the token, never again. */
export interface WebhookSecret { id: string; token: string; url: string }

export interface WebhookInfo { id: string; createdAt: string; tokenRotatedAt: string; lastUsedAt: string | null }

export function createBot(title: string, inviteeIds: string[]): Promise<{ conversationId: string; webhook: WebhookSecret; results: InviteResult[] }> {
  return apiFetch('/api/bots', { method: 'POST', body: JSON.stringify({ title, inviteeIds }) });
}

export function fetchBotWebhook(conversationId: string): Promise<{ webhook: WebhookInfo }> {
  return apiFetch(`/api/bots/${encodeURIComponent(conversationId)}/webhook`);
}

export function rotateBotWebhook(conversationId: string): Promise<{ webhook: WebhookSecret }> {
  return apiFetch(`/api/bots/${encodeURIComponent(conversationId)}/webhook/rotate`, { method: 'POST' });
}

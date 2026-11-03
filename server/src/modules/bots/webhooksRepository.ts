import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, servers, webhooks, type Webhook } from '../../db/schema.js';
import type { Tx } from '../users/userPairLock.js';

// A channel's webhooks — the credential an outside system posts through.

export interface WebhookInfo {
  id: string;
  name: string;
  avatar: string;
  createdAt: string;
  tokenRotatedAt: string;
  lastUsedAt: string | null;
}

/** The secret half of a webhook URL — returned to the owner once, never stored. */
export interface WebhookSecret { id: string; token: string }

export function generateWebhookToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function hashWebhookToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function toWebhookInfo(row: Webhook): WebhookInfo {
  return {
    id: row.id,
    name: row.name,
    avatar: row.avatar,
    createdAt: row.createdAt.toISOString(),
    tokenRotatedAt: row.tokenRotatedAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

export async function createWebhook(tx: Tx, conversationId: string, createdBy: string, name: string): Promise<WebhookSecret> {
  const token = generateWebhookToken();
  const [row] = await tx.insert(webhooks).values({
    id: crypto.randomUUID(), conversationId, name, tokenHash: hashWebhookToken(token), createdBy,
  }).returning({ id: webhooks.id });
  return { id: row!.id, token };
}

/** Replaces the token in place: the webhook keeps its id, so the old URL
 * stops working the moment the new one exists. */
export async function rotateWebhookToken(webhookId: string): Promise<WebhookSecret> {
  const token = generateWebhookToken();
  await db.update(webhooks).set({ tokenHash: hashWebhookToken(token), tokenRotatedAt: new Date() }).where(eq(webhooks.id, webhookId));
  return { id: webhookId, token };
}

/** The webhook these credentials open, when they're right and its channel
 * can still be posted to (its server not suspended). Wrong id and wrong
 * token look the same. */
export async function findWebhookByCredentials(id: string, token: string): Promise<Webhook | null> {
  const [row] = await db.select({ webhook: webhooks }).from(webhooks)
    .innerJoin(conversations, eq(conversations.id, webhooks.conversationId))
    .innerJoin(servers, eq(servers.id, conversations.serverId))
    .where(and(eq(webhooks.id, id), eq(conversations.type, 'text'), eq(servers.status, 'active')))
    .limit(1);
  if (!row) return null;
  const expected = Buffer.from(row.webhook.tokenHash, 'hex');
  const given = Buffer.from(hashWebhookToken(token), 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? row.webhook : null;
}

export async function markWebhookUsed(id: string): Promise<void> {
  await db.update(webhooks).set({ lastUsedAt: new Date() }).where(eq(webhooks.id, id));
}

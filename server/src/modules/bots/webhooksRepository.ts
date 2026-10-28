import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, webhooks, type Webhook } from '../../db/schema.js';
import type { Tx } from '../users/userPairLock.js';

// A bot posts through exactly one webhook today; the table allows more (one
// per source system, say) without a migration once there's UI for it.

export interface WebhookInfo {
  id: string;
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
    createdAt: row.createdAt.toISOString(),
    tokenRotatedAt: row.tokenRotatedAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

export async function createWebhook(tx: Tx, conversationId: string, createdBy: string): Promise<WebhookSecret> {
  const token = generateWebhookToken();
  const [row] = await tx.insert(webhooks).values({
    id: crypto.randomUUID(), conversationId, tokenHash: hashWebhookToken(token), createdBy,
  }).returning({ id: webhooks.id });
  return { id: row!.id, token };
}

export async function getBotWebhook(conversationId: string): Promise<Webhook | null> {
  const [row] = await db.select().from(webhooks).where(eq(webhooks.conversationId, conversationId)).orderBy(webhooks.createdAt).limit(1);
  return row ?? null;
}

/** Replaces the token in place: the webhook keeps its id, so the old URL
 * stops working the moment the new one exists. Null when the bot has none. */
export async function rotateBotWebhookToken(conversationId: string): Promise<WebhookSecret | null> {
  const webhook = await getBotWebhook(conversationId);
  if (!webhook) return null;
  const token = generateWebhookToken();
  await db.update(webhooks).set({ tokenHash: hashWebhookToken(token), tokenRotatedAt: new Date() }).where(eq(webhooks.id, webhook.id));
  return { id: webhook.id, token };
}

/** The webhook these credentials open, when they're right and its bot can
 * still be posted to (not suspended). Wrong id and wrong token look the same. */
export async function findWebhookByCredentials(id: string, token: string): Promise<Webhook | null> {
  const [row] = await db.select({ webhook: webhooks }).from(webhooks)
    .innerJoin(conversations, eq(conversations.id, webhooks.conversationId))
    .where(and(eq(webhooks.id, id), eq(conversations.type, 'bot'), eq(conversations.status, 'active')))
    .limit(1);
  if (!row) return null;
  const expected = Buffer.from(row.webhook.tokenHash, 'hex');
  const given = Buffer.from(hashWebhookToken(token), 'hex');
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? row.webhook : null;
}

export async function markWebhookUsed(id: string): Promise<void> {
  await db.update(webhooks).set({ lastUsedAt: new Date() }).where(eq(webhooks.id, id));
}

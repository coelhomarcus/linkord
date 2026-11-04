import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, servers, webhooks } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { generateWebhookToken, hashWebhookToken } from '../bots/webhooksRepository.js';
import { recordAudit, listAudit, type AuditActor } from './auditLog.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'admin' });

// The administrative view of webhooks: who posts how much where, and cutting
// a sender off. Read without joining anything: counts, never messages.

interface Ctx { actor: AuditActor; reason: string; requestId: string }

const isoOf = (column: unknown) => sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface AdminWebhookRow {
  id: string; name: string; avatar: string; channelId: string; channelName: string; serverId: string; serverName: string; serverStatus: string;
  createdAt: string; lastUsedAt: string | null; messageCount: number;
}

const webhookSelect = {
  id: webhooks.id, name: webhooks.name, avatar: webhooks.avatar,
  channelId: conversations.id, channelName: conversations.title, serverId: servers.id, serverName: servers.name, serverStatus: servers.status,
  createdAt: isoOf(webhooks.createdAt),
  lastUsedAt: sql<string | null>`case when ${webhooks.lastUsedAt} is null then null else ${isoOf(webhooks.lastUsedAt)} end`,
  messageCount: sql<number>`(select count(*)::int from messages mm where mm.webhook_id = ${webhooks.id})`,
};

export async function listAdminWebhooks(filters: { q?: string }, cursorRaw?: string): Promise<{ items: AdminWebhookRow[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const q = filters.q?.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db.select(webhookSelect).from(webhooks)
    .innerJoin(conversations, eq(conversations.id, webhooks.conversationId))
    .innerJoin(servers, eq(servers.id, conversations.serverId))
    .where(and(
      q ? sql`(lower(${webhooks.name}) like ${`%${q}%`} or lower(${servers.name}) like ${`%${q}%`} or ${webhooks.id} = ${filters.q?.trim() ?? ''})` : undefined,
      cursor ? sql`(${webhooks.createdAt}, ${webhooks.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(webhooks.createdAt), desc(webhooks.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.createdAt, last.id) : null };
}

export async function getAdminWebhook(webhookId: string) {
  const [row] = await db.select({
    ...webhookSelect,
    tokenRotatedAt: isoOf(webhooks.tokenRotatedAt),
    messagesLast24h: sql<number>`(select count(*)::int from messages mm where mm.webhook_id = ${webhooks.id} and mm.created_at > now() - interval '24 hours')`,
  }).from(webhooks)
    .innerJoin(conversations, eq(conversations.id, webhooks.conversationId))
    .innerJoin(servers, eq(servers.id, conversations.serverId))
    .where(eq(webhooks.id, webhookId)).limit(1);
  if (!row) return null;
  const history = await listAudit({ targetType: 'webhook', targetId: webhookId });
  return { webhook: row, history: history === 'invalid_cursor' ? [] : history.items };
}

export type WebhookActionResult = { code: 'ok' } | { code: 'not_found' };

/** Cuts a leaking or misbehaving sender off at once: the token is replaced by
 * one nobody is ever shown, so its URL stops working and only someone who
 * manages the channel generating a new one brings it back. */
export async function revokeWebhook(ctx: Ctx, webhookId: string): Promise<WebhookActionResult> {
  return db.transaction(async (tx): Promise<WebhookActionResult> => {
    const [updated] = await tx.update(webhooks)
      .set({ tokenHash: hashWebhookToken(generateWebhookToken()), tokenRotatedAt: new Date() })
      .where(eq(webhooks.id, webhookId))
      .returning({ id: webhooks.id, name: webhooks.name });
    if (!updated) return { code: 'not_found' };
    await recordAudit({
      actor: ctx.actor, action: 'webhook.revoke', targetType: 'webhook', targetId: webhookId, targetLabel: updated.name, reason: ctx.reason, requestId: ctx.requestId,
    }, tx);
    log.warn('webhook revoked by an admin', { actorId: ctx.actor.id, webhookId });
    return { code: 'ok' };
  });
}

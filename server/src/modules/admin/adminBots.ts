import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, webhooks } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { pageGroupMembers } from '../conversations/groupMembers.js';
import { generateWebhookToken, hashWebhookToken } from '../bots/webhooksRepository.js';
import { groupSelect, toRow, type AdminGroupRow } from './adminGroups.js';
import { recordAudit, listAudit, type AuditActor } from './auditLog.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'admin' });

// The administrative view of bots. Suspending, reactivating, reassigning and
// deleting one are the group actions run with kind 'bot' (adminGroups.ts);
// what's bot-only is its webhook — how much it posts, and cutting it off.
// Like a group, a bot is read without joining it: counts, never messages.

interface Ctx { actor: AuditActor; reason: string; requestId: string }

// Written with explicit aliases: in a single-table select drizzle leaves column
// names unqualified, and an unqualified "id" inside a messages subquery would be
// the message's own id, not the bot's.
const BOT_ID = sql.raw('"conversations"."id"');
// a bot has one webhook today; the oldest is the one its URL names
const webhookOf = (column: string) => sql.raw(`(select ${column} from webhooks w where w.conversation_id = "conversations"."id" order by w.created_at limit 1)`);
const isoOf = (column: string) => `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface AdminBotRow extends AdminGroupRow {
  messageCount: number;
  webhookLastUsedAt: string | null;
}

const botSelect = {
  ...groupSelect,
  messageCount: sql<number>`(select count(*)::int from messages mm where mm.conversation_id = ${BOT_ID})`,
  webhookLastUsedAt: sql<string | null>`${webhookOf(isoOf('w.last_used_at'))}`,
};

type BotSelectRow = Parameters<typeof toRow>[0] & { messageCount: number; webhookLastUsedAt: string | null };

function toBotRow(r: BotSelectRow): AdminBotRow {
  return { ...toRow(r), messageCount: r.messageCount, webhookLastUsedAt: r.webhookLastUsedAt };
}

export interface AdminBotFilters { q?: string; status?: string; orphan?: boolean }

export async function listAdminBots(filters: AdminBotFilters, cursorRaw?: string): Promise<{ items: AdminBotRow[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const q = filters.q?.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db
    .select(botSelect)
    .from(conversations)
    .where(and(
      eq(conversations.type, 'bot'),
      q ? sql`(lower(${conversations.title}) like ${`%${q}%`} or ${conversations.id} = ${filters.q?.trim() ?? ''})` : undefined,
      filters.status === 'active' || filters.status === 'suspended' ? eq(conversations.status, filters.status) : undefined,
      filters.orphan ? sql`${groupSelect.ownerId} is null` : undefined,
      cursor ? sql`(${conversations.createdAt}, ${conversations.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(conversations.createdAt), desc(conversations.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(toBotRow),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.group.id) : null,
  };
}

export async function getAdminBot(botId: string, membersCursor?: string) {
  const [row] = await db.select({
    ...botSelect,
    messagesLast24h: sql<number>`(select count(*)::int from messages mm where mm.conversation_id = ${BOT_ID} and mm.created_at > now() - interval '24 hours')`,
    webhookId: sql<string | null>`${webhookOf('w.id')}`,
    webhookCreatedAt: sql<string | null>`${webhookOf(isoOf('w.created_at'))}`,
    webhookRotatedAt: sql<string | null>`${webhookOf(isoOf('w.token_rotated_at'))}`,
  }).from(conversations).where(and(eq(conversations.id, botId), eq(conversations.type, 'bot'))).limit(1);
  if (!row) return null;
  const members = await pageGroupMembers(botId, membersCursor);
  const history = await listAudit({ targetType: 'bot', targetId: botId });
  return {
    bot: { ...toBotRow(row), statusReason: row.group.statusReason, messagesLast24h: row.messagesLast24h },
    webhook: row.webhookId
      ? { id: row.webhookId, createdAt: row.webhookCreatedAt!, tokenRotatedAt: row.webhookRotatedAt!, lastUsedAt: row.webhookLastUsedAt }
      : null,
    members: members === 'not_found' || members === 'invalid_cursor' ? { items: [], nextCursor: null } : members,
    history: history === 'invalid_cursor' ? [] : history.items,
  };
}

export type BotWebhookActionResult = { code: 'ok' } | { code: 'not_found' };

/** Cuts a leaking or misbehaving sender off at once: the token is replaced by
 * one nobody is ever shown, so every current URL stops working and only the
 * owner generating a new one brings the bot back. The bot itself stays. */
export async function revokeBotWebhook(ctx: Ctx, botId: string): Promise<BotWebhookActionResult> {
  return db.transaction(async (tx): Promise<BotWebhookActionResult> => {
    const locked = (await tx.execute(sql`select id, title from conversations where id = ${botId} and type = 'bot' for update`)).rows as { id: string; title: string }[];
    const bot = locked[0];
    if (!bot) return { code: 'not_found' };
    const updated = await tx.update(webhooks)
      .set({ tokenHash: hashWebhookToken(generateWebhookToken()), tokenRotatedAt: new Date() })
      .where(eq(webhooks.conversationId, botId))
      .returning({ id: webhooks.id });
    if (!updated.length) return { code: 'not_found' };
    await recordAudit({
      actor: ctx.actor, action: 'bot.revoke_webhook', targetType: 'bot', targetId: botId, targetLabel: bot.title, reason: ctx.reason,
      detail: { webhookIds: updated.map((w) => w.id) }, requestId: ctx.requestId,
    }, tx);
    log.warn('bot webhook revoked by an admin', { actorId: ctx.actor.id, botId });
    return { code: 'ok' };
  });
}

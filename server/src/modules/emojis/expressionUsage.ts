import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import emojiRegex from 'emoji-regex';
import { db } from '../../db/client.js';
import { userExpressionUsage } from '../../db/schema.js';
import { sendJson } from '../../http/respond.js';
import { requireSession } from '../servers/serverHttp.js';
import { logger } from '../../lib/logger.js';
import { customEmojiIds } from './customEmojiTokens.js';

const log = logger.child({ component: 'expression-usage' });

export type ExpressionKind = 'emoji' | 'sound';

// what each account keeps per kind: plenty for a picker's "frequently used"
// rows, few enough that the table stays tiny
const KEPT_PER_KIND = 100;
const LISTED_PER_KIND = 40;
// one message can't push more than this many emojis up the list
const MAX_KEYS_PER_USE = 20;
const MAX_KEY_LEN = 64;

/** The emojis a message uses, each once: its server emojis (as
 * `custom:<id>`), then its Unicode ones in order of appearance. */
export function emojiUsageKeys(text: string): string[] {
  const keys = new Set<string>(customEmojiIds(text).slice(0, MAX_KEYS_PER_USE).map((id) => `custom:${id}`));
  for (const match of text.matchAll(emojiRegex())) {
    if (keys.size >= MAX_KEYS_PER_USE) break;
    keys.add(match[0]);
  }
  return [...keys];
}

/** Counts one use of each key. Failures only get logged: this is a ranking
 * hint, never a reason for the send or the reaction to fail. */
export async function recordExpressionUsage(userId: string, kind: ExpressionKind, keys: string[]): Promise<void> {
  const unique = [...new Set(keys.filter((key) => key && key.length <= MAX_KEY_LEN))].slice(0, MAX_KEYS_PER_USE);
  if (!unique.length) return;
  try {
    await db.insert(userExpressionUsage)
      .values(unique.map((key) => ({ userId, kind, key })))
      .onConflictDoUpdate({
        target: [userExpressionUsage.userId, userExpressionUsage.kind, userExpressionUsage.key],
        set: { count: sql`${userExpressionUsage.count} + 1`, lastUsedAt: sql`now()` },
      });
    const kept = db.select({ key: userExpressionUsage.key }).from(userExpressionUsage)
      .where(and(eq(userExpressionUsage.userId, userId), eq(userExpressionUsage.kind, kind)))
      .orderBy(desc(userExpressionUsage.count), desc(userExpressionUsage.lastUsedAt))
      .limit(KEPT_PER_KIND);
    await db.delete(userExpressionUsage).where(and(
      eq(userExpressionUsage.userId, userId),
      eq(userExpressionUsage.kind, kind),
      notInArray(userExpressionUsage.key, kept),
    ));
  } catch (err) {
    log.warn('could not record expression usage', { userId, kind, err: err instanceof Error ? err.message : String(err) });
  }
}

interface FrequentExpression {
  key: string;
  count: number;
}

async function listFrequent(userId: string, kind: ExpressionKind): Promise<FrequentExpression[]> {
  return db.select({ key: userExpressionUsage.key, count: userExpressionUsage.count }).from(userExpressionUsage)
    .where(and(eq(userExpressionUsage.userId, userId), eq(userExpressionUsage.kind, kind)))
    .orderBy(desc(userExpressionUsage.count), desc(userExpressionUsage.lastUsedAt))
    .limit(LISTED_PER_KIND);
}

/** `GET /api/me/frequent-expressions` — most used first. A key may name an
 * emoji or sound that no longer exists; the client skips what it can't show. */
async function handleFrequent(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const sess = await requireSession(request, reply);
  if (!sess) return;
  const [emojis, sounds] = await Promise.all([listFrequent(sess.userId, 'emoji'), listFrequent(sess.userId, 'sound')]);
  sendJson(reply, 200, { emojis, sounds });
}

export function registerExpressionUsageRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/me/frequent-expressions', handleFrequent);
}

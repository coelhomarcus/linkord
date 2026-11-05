import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db } from '../../db/client.js';
import * as schema from '../../db/schema.js';

// Friendship and block transitions share a lock to prevent conflicting pair state.

export type Tx = NodePgDatabase<typeof schema>;

/** Deterministic ordering of a pair — doesn't need to be lexicographically
 * meaningful, just consistent so both directions hash to the same lock key. */
export function canonicalUserPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Runs `fn` inside a transaction that first takes a session-scoped
 * (`pg_advisory_xact_lock` — released automatically at commit/rollback,
 * never needs manual unlock) advisory lock keyed by the pair. Two requests
 * for the same pair (two tabs, or a friend-accept racing a block) now
 * genuinely serialize instead of just racing to satisfy DB constraints. */
export async function withUserPairLock<T>(userIdA: string, userIdB: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const [low, high] = canonicalUserPair(userIdA, userIdB);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${low}:${high}`}))`);
    return fn(tx);
  });
}

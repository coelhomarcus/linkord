import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type User } from '../../db/schema.js';
import type { Role } from '../../types.js';
import { invalidateSessionsForUser } from './session.js';
import { normalizeEmail } from '../users/users.js';
import type { Locale } from '../users/locale.js';

// Account lifecycle: create/register, and change the credential fields
// (username, email, password). `modules/users/users.ts` owns looking a user up and
// shaping it for a response — this file owns mutating the account itself.

/** Throws with `.code = 'account_identity_taken'` if a race loses to either
 * identity unique index despite the earlier checks. */
export async function createUser({ username, email, passwordHash, role, locale }: { username: string; email: string; passwordHash: string; role: Role; locale?: Locale }): Promise<User> {
  const id = crypto.randomUUID();
  try {
    const [row] = await db.insert(users).values({ id, username, email: normalizeEmail(email), passwordHash, role, ...(locale ? { locale } : {}) }).returning();
    return row!;
  } catch (err: unknown) {
    // drizzle wraps the driver error in DrizzleQueryError — Postgres's code
    // (23505 = unique_violation) is in err.cause.code, not err.code.
    const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
    if (cause?.code === '23505') {
      const dup = Object.assign(new Error('Esse nome de usuário ou e-mail já está em uso.'), { code: 'account_identity_taken' as const });
      throw dup;
    }
    throw err;
  }
}

export async function updateLocale(id: string, locale: Locale): Promise<void> {
  await db.update(users).set({ locale, updatedAt: new Date() }).where(eq(users.id, id));
  invalidateSessionsForUser(id);
}

export async function updateEmail(id: string, email: string): Promise<User | null> {
  try {
    const [row] = await db.update(users)
      .set({ email: normalizeEmail(email), updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    invalidateSessionsForUser(id);
    return row || null;
  } catch (err: unknown) {
    const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
    if (cause?.code === '23505') {
      throw Object.assign(new Error('Esse e-mail já está em uso.'), { code: 'email_taken' as const });
    }
    throw err;
  }
}

/** Throws with `.code = 'username_taken'` when another account took the name (any letter case) between the
 * route's check and this write: `users_username_lower_key` is what settles that race. Existing sessions stay
 * valid; their cached copy is dropped so the next request reads the new name. */
export async function updateUsername(id: string, username: string): Promise<User | null> {
  try {
    const [row] = await db.update(users)
      .set({ username, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    invalidateSessionsForUser(id);
    return row || null;
  } catch (err: unknown) {
    const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
    if (cause?.code === '23505') {
      throw Object.assign(new Error('Esse nome de usuário já está em uso.'), { code: 'username_taken' as const });
    }
    throw err;
  }
}

export async function updatePassword(id: string, passwordHash: string): Promise<User | null> {
  const [row] = await db.update(users)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return row || null;
}


import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { userPreferences } from '../../db/schema.js';
import { sendToUser } from '../presence/participants.js';
import { applyPreferenceChanges, cleanStoredPreferences, type PreferenceChanges, type Preferences } from './preferencesPolicy.js';

/** null when the account never synced (no row): the client then seeds it from its own browser. */
export async function getPreferences(userId: string): Promise<Preferences | null> {
  const [row] = await db.select({ data: userPreferences.data }).from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
  return row ? cleanStoredPreferences(row.data) : null;
}

/** Applies `changes` (per key, so two devices editing different keys both win) and tells every tab of
 * the account, including the one that asked, which ignores what it already has. */
export async function updatePreferences(userId: string, changes: PreferenceChanges): Promise<Preferences | 'too_many'> {
  const result = await db.transaction(async (tx) => {
    await tx.insert(userPreferences).values({ userId }).onConflictDoNothing();
    const [row] = await tx.select({ data: userPreferences.data }).from(userPreferences)
      .where(eq(userPreferences.userId, userId)).for('update');
    const next = applyPreferenceChanges(cleanStoredPreferences(row?.data), changes);
    if (next === 'too_many') return next;
    await tx.update(userPreferences).set({ data: next, updatedAt: sql`now()` }).where(eq(userPreferences.userId, userId));
    return next;
  });
  if (result !== 'too_many') sendToUser(userId, { t: 'my-preferences', changes });
  return result;
}

/** The first device's own settings become the account's, once: when the account already has a row
 * (another device seeded or changed something first), nothing is written and the stored values come back. */
export async function seedPreferences(userId: string, values: PreferenceChanges): Promise<Preferences | 'too_many'> {
  const seeded = applyPreferenceChanges({}, values);
  if (seeded === 'too_many') return seeded;
  const inserted = await db.insert(userPreferences).values({ userId, data: seeded }).onConflictDoNothing()
    .returning({ userId: userPreferences.userId });
  if (inserted.length === 0) return (await getPreferences(userId)) ?? {};
  sendToUser(userId, { t: 'my-preferences', changes: seeded });
  return seeded;
}

import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { instanceSecrets } from '../../db/schema.js';
import { setMediaProxyKey } from './mediaProxyUrls.js';

const KEY_NAME = 'media_proxy';

/** Reads the key the proxied addresses are signed with, creating it the first
 * time. Kept in the database rather than made per process: an address a tab
 * already holds must still open after a deploy. */
export async function loadMediaProxyKey(): Promise<void> {
  await db.insert(instanceSecrets).values({ name: KEY_NAME, value: crypto.randomBytes(32).toString('base64') }).onConflictDoNothing();
  const [row] = await db.select({ value: instanceSecrets.value }).from(instanceSecrets).where(eq(instanceSecrets.name, KEY_NAME));
  if (!row) throw new Error('media proxy key missing after insert');
  setMediaProxyKey(Buffer.from(row.value, 'base64'));
}

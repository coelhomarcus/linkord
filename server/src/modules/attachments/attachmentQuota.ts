import { eq, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, serverSounds, messages } from '../../db/schema.js';
import { sendToUser } from '../presence/participants.js';
import { stagedBytes } from './stagedAttachments.js';

export interface UsageInfo {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

/** Counts committed files and sounds on every request. Include profile images too: frequent
 * replacements contribute to write volume even when each account keeps only one current image.
 * Chat attachments also have a separate per-user quota. */
export async function getUsage(): Promise<UsageInfo> {
  const [row] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${attachmentsTable.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(attachmentsTable);
  const [sounds] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${serverSounds.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(serverSounds);
  const staged = await stagedBytes();
  return {
    totalBytes: Number(row!.totalBytes) + Number(sounds!.totalBytes) + staged.bytes,
    totalFiles: Number(row!.totalFiles) + Number(sounds!.totalFiles) + staged.files,
    maxBytes: config.MAX_STORAGE_BYTES,
  };
}

/** The figure an ordinary account sees: ITS OWN storage against ITS OWN
 * quota. The instance-wide total is an administrative number (§8.3) and is
 * no longer sent to everyone. */
export async function getUserUsage(userId: string): Promise<UsageInfo> {
  const [row] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${attachmentsTable.size}), 0)::float8`, totalFiles: sql<number>`count(${attachmentsTable.id})::int` })
    .from(attachmentsTable)
    .innerJoin(messages, eq(messages.id, attachmentsTable.messageId))
    .where(eq(messages.authorId, userId));
  // files waiting to be sent are already on disk and already this account's
  const staged = await stagedBytes(userId);
  return { totalBytes: Number(row?.totalBytes ?? 0) + staged.bytes, totalFiles: Number(row?.totalFiles ?? 0) + staged.files, maxBytes: config.MAX_USER_STORAGE_BYTES };
}

/** Tells one account how much of its quota is used (after an upload, or after
 * one of its messages with files was deleted). */
export async function sendUsageToUser(userId: string): Promise<void> {
  sendToUser(userId, { t: 'storage-usage', ...(await getUserUsage(userId)) });
}

import { sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, serverSounds } from '../../db/schema.js';
import { stagedBytes } from './stagedAttachments.js';

export interface UsageInfo {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

/** Counts committed files and sounds on every request. Include profile images too: frequent
 * replacements contribute to write volume even when each account keeps only one current image.
 * This instance-wide figure is the only storage limit: accounts have no quota of their own. */
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

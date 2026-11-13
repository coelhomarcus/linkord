import { sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, serverEmojis, serverSounds, serverStickers } from '../../db/schema.js';
import { stagedBytes } from './stagedAttachments.js';
import { getReservedBytes } from './uploadSession.js';

export interface UsageInfo {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

/** Counts committed files, sounds, server emojis and stickers on every request. Include profile images too: frequent
 * replacements contribute to write volume even when each account keeps only one current image.
 * Accounts have no quota of their own for what they sent; only what is not sent yet is capped per
 * account (see attachmentUploads.ts#handleAttachmentInit). */
export async function getUsage(): Promise<UsageInfo> {
  const [row] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${attachmentsTable.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(attachmentsTable);
  const [sounds] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${serverSounds.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(serverSounds);
  const [emojis] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${serverEmojis.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(serverEmojis);
  const [stickers] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${serverStickers.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(serverStickers);
  const staged = await stagedBytes();
  return {
    totalBytes: Number(row!.totalBytes) + Number(sounds!.totalBytes) + Number(emojis!.totalBytes) + Number(stickers!.totalBytes) + staged.bytes,
    totalFiles: Number(row!.totalFiles) + Number(sounds!.totalFiles) + Number(emojis!.totalFiles) + Number(stickers!.totalFiles) + staged.files,
    maxBytes: config.MAX_STORAGE_BYTES,
  };
}

/** Whether `bytes` more fit under MAX_STORAGE_BYTES, counting what open
 * chunked uploads have reserved: every path that writes a file asks this, so
 * none of them can spend space an admitted upload was promised. An upload
 * checking for itself passes its id, its own reservation being in the sum. */
export async function hasRoomFor(bytes: number, ownUploadId?: string): Promise<boolean> {
  const usage = await getUsage();
  return usage.totalBytes + getReservedBytes(ownUploadId) + bytes <= config.MAX_STORAGE_BYTES;
}

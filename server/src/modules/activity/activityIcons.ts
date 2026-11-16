import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config/env.js';
import { encodeSquareWebp } from '../emojis/emojiFile.js';

// The icon of an app (or of a game IGDB does not know), as the desktop app reads it from the program
// itself. Stored once under the hash of what was stored, so everyone running the same program shares
// one file, and nobody can choose a name. Re-encoded here: the bytes sent are never served as they came.

export const ACTIVITY_ICON_PX = 64;
export const MAX_ACTIVITY_ICON_UPLOAD_BYTES = 256 * 1024;
const MAX_ACTIVITY_ICON_BYTES = 32 * 1024;
const ICON_ID = /^[0-9a-f]{64}$/;

export function activityIconDir(): string {
  return path.join(config.UPLOAD_DIR, 'activity-icons');
}

export function isActivityIconId(value: unknown): value is string {
  return typeof value === 'string' && ICON_ID.test(value);
}

export function activityIconPath(id: string, dir = activityIconDir()): string {
  return path.join(dir, `${id}.webp`);
}

/** The stored icon's id, or why the picture was refused. */
export async function storeActivityIcon(input: Buffer, dir = activityIconDir()): Promise<{ id: string } | 'invalid_image' | 'too_large'> {
  const encoded = await encodeSquareWebp(input, { size: ACTIVITY_ICON_PX, maxBytes: MAX_ACTIVITY_ICON_BYTES });
  if (encoded === 'invalid_image' || encoded === 'invalid_crop') return 'invalid_image';
  if (encoded === 'too_large') return 'too_large';
  const id = crypto.createHash('sha256').update(encoded.data).digest('hex');
  const file = activityIconPath(id, dir);
  try {
    await fs.access(file);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    // written aside and renamed, so a reader never gets half a file
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, encoded.data);
    await fs.rename(temporary, file);
  }
  return { id };
}

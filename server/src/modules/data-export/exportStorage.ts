import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config/env.js';

// Where export ZIPs live on disk. A leaf (config only) so the account purge in admin/adminUsers.ts can
// remove an account's exports without depending on the export job.

const EXPORT_ID_RE = /^[0-9a-f-]{36}$/;

export function exportFilePath(id: string): string {
  if (!EXPORT_ID_RE.test(id)) throw new Error('invalid export id');
  return path.join(config.EXPORT_DIR, `${id}.zip`);
}

/** The export id a file in EXPORT_DIR belongs to, or null for anything that is not ours (a half-written
 * `.part`, a stray file). */
export function exportIdOfFile(name: string): string | null {
  const id = name.endsWith('.zip') ? name.slice(0, -4) : '';
  return EXPORT_ID_RE.test(id) ? id : null;
}

export async function ensureExportDir(): Promise<void> {
  await fs.mkdir(config.EXPORT_DIR, { recursive: true });
}

export async function deleteExportFiles(ids: string[]): Promise<void> {
  for (const id of ids) {
    await fs.unlink(exportFilePath(id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
  }
}

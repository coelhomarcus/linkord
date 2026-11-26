import type { Dirent } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { FILE_ID_RE } from '../attachments/orphanClassification.js';
import { BackupError, isSafeArchiveEntry } from './backupLayout.js';
import { runTool } from './postgresTools.js';

// The uploads folder on both sides of a backup. `tmp/` holds chunked uploads
// still in progress (half a file is useless on its own and the client starts
// that upload again), so it is left out. So is EXPORT_DIR when it lies inside
// the folder: data exports are copies of personal data that expire within days,
// and a person can ask for a new one; a backup kept for weeks must not hold them.
// `exports/` (its default) is skipped by name too, for exports left there before
// EXPORT_DIR moved. A mounted volume's own `lost+found` is not content either.

const SKIPPED_TOP_LEVEL = new Set(['tmp', 'exports', 'lost+found']);

/** `dir` as a POSIX path relative to `uploadDir`, or null when it is not strictly inside it. */
function insidePath(uploadDir: string, dir: string): string | null {
  const relative = path.relative(path.resolve(uploadDir), path.resolve(dir));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join('/');
}

/** Every regular file a backup takes from `uploadDir`, as POSIX paths relative to it, sorted. Symbolic
 * links are left out: following one could archive something outside the folder. `excludedDirs` (absolute
 * or relative to the working directory) are left out with everything in them, wherever they are nested. */
export async function listUploadFiles(uploadDir: string, excludedDirs: string[] = []): Promise<string[]> {
  const excluded = new Set(excludedDirs.map((dir) => insidePath(uploadDir, dir)).filter((dir): dir is string => dir !== null));
  const files: string[] = [];
  async function walk(relative: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(path.join(uploadDir, relative), { withFileTypes: true });
    } catch (err) {
      // the folder itself may not exist yet; a subfolder may vanish while we walk
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      if (relative === '' && SKIPPED_TOP_LEVEL.has(entry.name)) continue;
      const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) { if (!excluded.has(child)) await walk(child); }
      else if (entry.isFile()) files.push(child);
    }
  }
  await walk('');
  return files.sort();
}

/** True for a path that is a stored file the database can point at (top level, named by its id). */
export const isStoredFileName = (relativePath: string): boolean => FILE_ID_RE.test(relativePath);

// ---- format 1 (folder with uploads.tar.gz), read by restore only ----

/** Archive entries as tar lists them: directories end with a slash. */
export async function listArchive(archive: string, tar = 'tar'): Promise<string[]> {
  const { stdout } = await runTool({ bin: tar, args: ['-tzf', archive], what: 'Listing the uploads archive' });
  return stdout.split('\n').map((line) => line.replace(/\r$/, '')).filter(Boolean);
}

export async function extractUploadsArchive(archive: string, uploadDir: string, tar = 'tar'): Promise<number> {
  const entries = await listArchive(archive, tar);
  const unsafe = entries.find((entry) => !isSafeArchiveEntry(entry));
  if (unsafe !== undefined) throw new BackupError(`The uploads archive contains an unsafe path ("${unsafe}"); refusing to extract it.`);
  await fsp.mkdir(uploadDir, { recursive: true });
  await runTool({ bin: tar, args: ['-xzf', archive, '-C', uploadDir], what: 'Extracting the uploads archive' });
  return entries.filter((entry) => !entry.endsWith('/')).length;
}

// ---- after a restore ----

/** Stored files (and everything else regular) directly in the folder, as the admin storage check sees them. */
export async function listStoredFiles(uploadDir: string): Promise<{ name: string; size: number; mtimeMs: number }[]> {
  let names: string[];
  try {
    names = await fsp.readdir(uploadDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files: { name: string; size: number; mtimeMs: number }[] = [];
  for (const name of names) {
    if (!FILE_ID_RE.test(name)) continue;
    const stat = await fsp.stat(path.join(uploadDir, name)).catch(() => null);
    if (stat?.isFile()) files.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return files;
}

export const isEmptyDirectory = async (dir: string): Promise<boolean> => {
  try {
    // a mounted volume's own `lost+found` is not content
    return (await fsp.readdir(dir)).filter((name) => name !== 'lost+found').length === 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw err;
  }
};

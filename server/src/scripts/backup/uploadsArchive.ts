import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { FILE_ID_RE } from '../../modules/attachments/orphanClassification.js';
import { BackupError } from './backupLayout.js';
import { runTool, sha256OfFile } from './postgresTools.js';

// The uploads folder as one `.tar.gz`. `tmp/` holds chunked uploads still in
// progress (half a file is useless on its own and the client starts that upload
// again), so it is left out. The archive is built from an explicit list of names
// rather than a directory walk by tar, so the exclusion does not depend on which
// tar (GNU, BSD, busybox) is installed.

const SKIPPED_TOP_LEVEL = new Set(['tmp']);

export interface UploadsArchive {
  /** null when the folder had nothing to archive, in which case no file was written */
  sha256: string | null;
  /** Regular files that made it into the archive. */
  files: number;
  bytes: number;
  /** Top-level names of stored files in the archive, to compare against the database. */
  storedNames: Set<string>;
}

async function topLevelEntries(uploadDir: string): Promise<string[]> {
  try {
    const names = (await fsp.readdir(uploadDir)).filter((name) => !SKIPPED_TOP_LEVEL.has(name));
    // the list goes to tar one per line
    if (names.some((name) => /[\r\n]/.test(name))) throw new BackupError(`${uploadDir} has a file name with a line break, which cannot be archived.`);
    return names;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/** Archive entries as tar lists them: directories end with a slash. */
export async function listArchive(archive: string, tar = 'tar'): Promise<string[]> {
  const { stdout } = await runTool({ bin: tar, args: ['-tzf', archive], what: 'Listing the uploads archive' });
  return stdout.split('\n').map((line) => line.replace(/\r$/, '')).filter(Boolean);
}

export async function createUploadsArchive(uploadDir: string, archive: string, tar = 'tar'): Promise<UploadsArchive> {
  const names = await topLevelEntries(uploadDir);
  if (names.length === 0) return { sha256: null, files: 0, bytes: 0, storedNames: new Set() };

  // A file deleted between the listing and tar reading it makes tar exit 1 (GNU) or fail (BSD);
  // what matters is what ended up in the archive, which is read back below.
  await runTool({
    bin: tar, args: ['-czf', archive, '-C', uploadDir, '-T', '-'], input: Readable.from([`${names.join('\n')}\n`]),
    okCodes: [0, 1], what: 'Archiving the uploads folder',
  });
  const entries = (await listArchive(archive, tar)).filter((entry) => !entry.endsWith('/'));
  let bytes = 0;
  for (const entry of entries) bytes += await fsp.stat(path.join(uploadDir, entry)).then((s) => s.size, () => 0);
  const storedNames = new Set(entries.filter((entry) => FILE_ID_RE.test(entry)));
  return { sha256: await sha256OfFile(archive), files: entries.length, bytes, storedNames };
}

/** False for anything that could land outside the folder it is extracted into. */
export function isSafeArchiveEntry(entry: string): boolean {
  if (entry === '' || entry.startsWith('/') || entry.includes('\\') || /^[a-zA-Z]:/.test(entry)) return false;
  return !entry.split('/').includes('..');
}

export async function extractUploadsArchive(archive: string, uploadDir: string, tar = 'tar'): Promise<number> {
  const entries = await listArchive(archive, tar);
  const unsafe = entries.find((entry) => !isSafeArchiveEntry(entry));
  if (unsafe !== undefined) throw new BackupError(`The uploads archive contains an unsafe path ("${unsafe}"); refusing to extract it.`);
  await fsp.mkdir(uploadDir, { recursive: true });
  await runTool({ bin: tar, args: ['-xzf', archive, '-C', uploadDir], what: 'Extracting the uploads archive' });
  return entries.filter((entry) => !entry.endsWith('/')).length;
}

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


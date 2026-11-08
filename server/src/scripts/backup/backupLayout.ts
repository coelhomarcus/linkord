import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

// What a backup looks like on disk, and how old ones are rotated. No database
// and no child processes here, so all of it is testable with a temp folder.

/** A problem the operator can act on; the CLIs print the message and exit. */
export class BackupError extends Error {}

export const BACKUP_FORMAT = 1;
export const DUMP_FILE = 'database.dump';
export const UPLOADS_FILE = 'uploads.tar.gz';
export const MANIFEST_FILE = 'manifest.json';
export const PARTIAL_SUFFIX = '.partial';
const DEFAULT_KEEP = 7;

// The exact shape rotation is allowed to delete. A backup folder may be shared
// with other things (a mounted disk, someone's notes), and only names that match
// this are ever touched.
const BACKUP_NAME_RE = /^linkord-backup-\d{8}T\d{6}Z$/;
const PARTIAL_NAME_RE = /^linkord-backup-\d{8}T\d{6}Z\.partial$/;
// An unfinished folder younger than this may belong to a run that is still going.
const STALE_PARTIAL_MS = 24 * 60 * 60 * 1000;

const isBackupName = (name: string): boolean => BACKUP_NAME_RE.test(name);

/** UTC, so the name sorts by time and does not depend on the host's timezone. */
export function backupName(date: Date): string {
  const iso = date.toISOString(); // 2026-11-08T01:53:00.123Z
  return `linkord-backup-${iso.slice(0, 10).replaceAll('-', '')}T${iso.slice(11, 19).replaceAll(':', '')}Z`;
}

export interface BackupManifest {
  format: number;
  createdAt: string;
  database: { name: string; serverVersion: string; dumpTool: string };
  /** Applied migrations, so a restore can tell the schema came across whole. */
  migrations: number;
  /** Exact row count of every table in the snapshot the dump was taken from. */
  tables: Record<string, number>;
  uploads: {
    files: number;
    bytes: number;
    /** Rows in the snapshot whose file was already gone when the archive was made (deleted in between). */
    missingFromArchive: number;
  };
  sha256: { dump: string; uploads: string | null };
}

/** A manifest that fails this is a damaged or foreign folder: restore must not start from it. */
export function parseManifest(text: string): BackupManifest {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new BackupError(`${MANIFEST_FILE} is not valid JSON.`); }
  const m = raw as Partial<BackupManifest> | null;
  const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  if (!m || typeof m !== 'object') throw new BackupError(`${MANIFEST_FILE} is empty.`);
  if (m.format !== BACKUP_FORMAT) throw new BackupError(`Unsupported backup format ${String(m.format)}; this version reads format ${BACKUP_FORMAT}.`);
  const tables = m.tables;
  const valid = typeof m.createdAt === 'string'
    && typeof m.database?.name === 'string' && isCount(m.migrations)
    && tables !== undefined && tables !== null && typeof tables === 'object' && Object.values(tables).every(isCount)
    && isCount(m.uploads?.files) && isCount(m.uploads?.bytes) && isCount(m.uploads?.missingFromArchive)
    && isHash(m.sha256?.dump) && (m.sha256?.uploads === null || isHash(m.sha256?.uploads));
  if (!valid) throw new BackupError(`${MANIFEST_FILE} is incomplete or damaged.`);
  return m as BackupManifest;
}

/** Finished backups in `dir`, newest first. A folder without a manifest is not a backup. */
export async function listBackups(dir: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isBackupName(entry.name)) continue;
    const hasManifest = await fs.stat(path.join(dir, entry.name, MANIFEST_FILE)).then((s) => s.isFile(), () => false);
    if (hasManifest) names.push(entry.name);
  }
  return names.sort().reverse();
}

export function parseKeep(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_KEEP;
  const keep = Number(raw);
  if (!Number.isSafeInteger(keep) || keep < 1) throw new BackupError(`BACKUP_KEEP must be a whole number of backups, at least 1 (got "${raw}").`);
  return keep;
}

/** Deletes everything but the newest `keep` finished backups, plus unfinished
 * folders a crashed run left behind. Called only after a new backup is complete,
 * so a failing run never shrinks the history. Returns what it removed. */
export async function rotateBackups(dir: string, keep: number, now = Date.now()): Promise<string[]> {
  if (!Number.isSafeInteger(keep) || keep < 1) throw new BackupError('Refusing to rotate with a keep count below 1.');
  const removed: string[] = [];
  for (const name of (await listBackups(dir)).slice(keep)) {
    await fs.rm(path.join(dir, name), { recursive: true, force: true });
    removed.push(name);
  }
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !PARTIAL_NAME_RE.test(entry.name)) continue;
    const { mtimeMs } = await fs.stat(path.join(dir, entry.name));
    if (now - mtimeMs < STALE_PARTIAL_MS) continue;
    await fs.rm(path.join(dir, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

/** `latest`, a backup folder name inside `dir`, or a path to a backup folder. */
export async function resolveBackup(dir: string, ref: string): Promise<string> {
  if (ref === 'latest') {
    const [newest] = await listBackups(dir);
    if (!newest) throw new BackupError(`No backups found in ${dir}.`);
    return path.join(dir, newest);
  }
  const candidates = [path.resolve(ref), path.join(dir, ref)];
  for (const candidate of candidates) {
    if (await fs.stat(path.join(candidate, MANIFEST_FILE)).then((s) => s.isFile(), () => false)) return candidate;
  }
  throw new BackupError(`"${ref}" is not a backup folder (no ${MANIFEST_FILE} in it or in ${dir}).`);
}

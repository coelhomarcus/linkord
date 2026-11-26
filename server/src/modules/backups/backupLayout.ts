import crypto from 'node:crypto';

// What a backup looks like. No database and no child processes here, so all of
// it is testable on its own.
//
// Format 2 (current) is one ZIP, written as a stream and never kept by the server:
//   README.txt       what it is and how to restore it
//   database.dump    pg_dump, custom format
//   uploads/<path>   every stored file, one entry each (UPLOAD_DIR without tmp/ and exports/)
//   manifest.json    last, because it describes what came before it
// Format 1 was a folder (database.dump, uploads.tar.gz, manifest.json) that older
// versions wrote into BACKUP_DIR. Restore still reads it.

/** A problem the operator can act on; the CLIs print the message and exit. */
export class BackupError extends Error {}

export const BACKUP_FORMAT = 2;
const LEGACY_FOLDER_FORMAT = 1;
export const README_FILE = 'README.txt';
export const DUMP_FILE = 'database.dump';
export const MANIFEST_FILE = 'manifest.json';
/** Where the stored files go inside the ZIP. */
export const UPLOADS_PREFIX = 'uploads/';
/** The uploads archive of a format 1 folder. */
export const UPLOADS_FILE = 'uploads.tar.gz';

/** UTC, so names sort by time and do not depend on the host's timezone. */
export function backupFileName(date: Date): string {
  const iso = date.toISOString(); // 2026-11-08T01:53:00.123Z
  return `overcord-backup-${iso.slice(0, 10).replaceAll('-', '')}T${iso.slice(11, 19).replaceAll(':', '')}Z.zip`;
}

export interface BackupManifest {
  /** 2 for a ZIP, 1 for a legacy folder. */
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
  /** `uploads` is the UploadsDigest of the files in a ZIP, or the SHA-256 of uploads.tar.gz in a folder; null with no files. */
  sha256: { dump: string; uploads: string | null };
}

/** A manifest that fails this is a damaged or foreign backup: restore must not start from it. */
export function parseManifest(text: string): BackupManifest {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new BackupError(`${MANIFEST_FILE} is not valid JSON.`); }
  const m = raw as Partial<BackupManifest> | null;
  const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
  const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
  if (!m || typeof m !== 'object') throw new BackupError(`${MANIFEST_FILE} is empty.`);
  if (m.format !== BACKUP_FORMAT && m.format !== LEGACY_FOLDER_FORMAT) {
    throw new BackupError(`Unsupported backup format ${String(m.format)}; this version reads formats ${LEGACY_FOLDER_FORMAT} and ${BACKUP_FORMAT}.`);
  }
  const tables = m.tables;
  const valid = typeof m.createdAt === 'string'
    && typeof m.database?.name === 'string' && isCount(m.migrations)
    && tables !== undefined && tables !== null && typeof tables === 'object' && Object.values(tables).every(isCount)
    && isCount(m.uploads?.files) && isCount(m.uploads?.bytes) && isCount(m.uploads?.missingFromArchive)
    && isHash(m.sha256?.dump) && (m.sha256?.uploads === null || isHash(m.sha256?.uploads));
  if (!valid) throw new BackupError(`${MANIFEST_FILE} is incomplete or damaged.`);
  return m as BackupManifest;
}

/** One SHA-256 over every stored file in the order the ZIP holds them, each preceded by its path and size.
 * The writer computes it while streaming and the restore recomputes it from the entries: ZIP readers do not
 * check CRC-32, so this is what catches a damaged file. It is not a signature: whoever changes the files can
 * recompute it. */
export class UploadsDigest {
  private readonly hash = crypto.createHash('sha256');
  private files = 0;

  begin(relativePath: string, size: number): void {
    this.files++;
    this.hash.update(`${relativePath}\0${size}\0`);
  }

  update(chunk: Buffer): void {
    this.hash.update(chunk);
  }

  /** null when there were no files, like a folder backup without uploads.tar.gz. */
  digest(): string | null {
    return this.files === 0 ? null : this.hash.digest('hex');
  }
}

/** False for anything that could land outside the folder it is extracted into. */
export function isSafeArchiveEntry(entry: string): boolean {
  if (entry === '' || entry.startsWith('/') || entry.includes('\\') || /^[a-zA-Z]:/.test(entry)) return false;
  return !entry.split('/').includes('..');
}

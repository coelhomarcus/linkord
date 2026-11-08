import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { classifyOrphans } from '../../modules/attachments/orphanClassification.js';
import { BackupError, DUMP_FILE, MANIFEST_FILE, parseManifest, UPLOADS_FILE, type BackupManifest } from './backupLayout.js';
import { pgConnection, runTool, sha256OfFile, withConnection, type DatabaseSsl } from './postgresTools.js';
import { extractUploadsArchive, isEmptyDirectory, listStoredFiles } from './uploadsArchive.js';

export interface RestoreOptions {
  /** A finished backup folder. */
  backupPath: string;
  databaseUrl: string;
  ssl?: DatabaseSsl;
  uploadDir: string;
  /** Must equal the name of the database in `databaseUrl`; the operator types it, so a wrong .env cannot restore unnoticed. */
  confirm: string | undefined;
  pgRestoreBin?: string;
  tarBin?: string;
  log?: (message: string) => void;
}

interface IntegrityReport {
  /** The restore did not reproduce the backup. */
  errors: string[];
  /** Worth knowing, nothing is lost. */
  warnings: string[];
  tracked: number;
  missingFiles: number;
  orphanFiles: number;
}

export interface RestoreResult { manifest: BackupManifest; integrity: IntegrityReport }

/** Raised when the restore was not started because the operator has not confirmed the target. */
export class ConfirmationRequired extends BackupError {
  readonly target: string;
  readonly database: string;
  constructor(target: string, database: string) {
    super(`This restores into database "${database}" at ${target}.`);
    this.target = target;
    this.database = database;
  }
}

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Reads the manifest and proves the files next to it are the ones it describes, before anything is touched. */
export async function readBackup(backupPath: string): Promise<{ manifest: BackupManifest; dumpFile: string; uploadsFile: string | null }> {
  const manifest = parseManifest(await fsp.readFile(path.join(backupPath, MANIFEST_FILE), 'utf8').catch(() => {
    throw new BackupError(`${backupPath} has no ${MANIFEST_FILE}; it is not a finished backup.`);
  }));
  const dumpFile = path.join(backupPath, DUMP_FILE);
  if ((await sha256OfFile(dumpFile).catch(() => null)) !== manifest.sha256.dump) throw new BackupError(`${DUMP_FILE} is missing or does not match the checksum in the manifest; the backup is damaged.`);
  let uploadsFile: string | null = null;
  if (manifest.sha256.uploads !== null) {
    uploadsFile = path.join(backupPath, UPLOADS_FILE);
    if ((await sha256OfFile(uploadsFile).catch(() => null)) !== manifest.sha256.uploads) throw new BackupError(`${UPLOADS_FILE} is missing or does not match the checksum in the manifest; the backup is damaged.`);
  }
  return { manifest, dumpFile, uploadsFile };
}

/** Compares a restored database and uploads folder with what the manifest says the backup held. */
async function verifyRestore(pool: Pool, uploadDir: string, manifest: BackupManifest, extractedFiles: number): Promise<IntegrityReport> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const present = (await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'")).rows.map((r) => r.table_name);
  for (const name of Object.keys(manifest.tables)) if (!present.includes(name)) errors.push(`table ${name} is missing`);
  for (const name of present) if (!(name in manifest.tables)) errors.push(`table ${name} was not in the backup`);
  for (const [name, expected] of Object.entries(manifest.tables)) {
    if (!present.includes(name)) continue;
    const actual = Number((await pool.query<{ n: string }>(`select count(*) as n from public.${quoteIdent(name)}`)).rows[0]!.n);
    if (actual !== expected) errors.push(`table ${name} has ${actual} rows, the backup had ${expected}`);
  }
  const migrationsTable = (await pool.query<{ r: string | null }>("select to_regclass('drizzle.__drizzle_migrations') as r")).rows[0]!.r;
  const migrations = migrationsTable ? Number((await pool.query<{ n: string }>('select count(*) as n from drizzle.__drizzle_migrations')).rows[0]!.n) : 0;
  if (migrations !== manifest.migrations) errors.push(`${plural(migrations, 'migration')} recorded, the backup had ${manifest.migrations}`);

  // Same comparison as /admin/system: every file the database points at against what is on disk.
  const files = await listStoredFiles(uploadDir);
  const ids = await pool.query<{ id: string }>(
    `select id from attachments
     union select id from server_sounds
     union select id from staged_attachments
     union select thumb_id from staged_attachments where thumb_id is not null`);
  const { orphans, tracked, missingFiles } = classifyOrphans({ files, dbIds: new Set(ids.rows.map((r) => r.id)), now: Date.now(), graceMs: 0 });

  if (extractedFiles !== manifest.uploads.files) errors.push(`${plural(extractedFiles, 'file')} extracted, the backup had ${manifest.uploads.files}`);
  if (missingFiles > manifest.uploads.missingFromArchive) {
    errors.push(`${plural(missingFiles, 'attachment')} point to a file that is not on disk, but only ${manifest.uploads.missingFromArchive} were missing when the backup was made`);
  } else if (missingFiles > 0) {
    warnings.push(`${plural(missingFiles, 'attachment')} point to a file that is not on disk. It was deleted between the database snapshot and the archive; its message shows a broken attachment.`);
  }
  if (orphans.length > 0) warnings.push(`${plural(orphans.length, 'file')} on disk have no database row (uploaded after the snapshot, or left behind earlier); the orphan sweep reports them.`);

  return { errors, warnings, tracked, missingFiles, orphanFiles: orphans.length };
}

export async function restoreBackup(opts: RestoreOptions): Promise<RestoreResult> {
  const log = opts.log ?? (() => {});
  const { manifest, dumpFile, uploadsFile } = await readBackup(opts.backupPath);
  log(`backup ${path.basename(opts.backupPath)} verified (checksums match)`);

  const target = pgConnection(opts.databaseUrl, opts.ssl);
  if (opts.confirm !== target.database) throw new ConfirmationRequired(`${target.host}:${target.port}`, target.database);

  if (!(await isEmptyDirectory(opts.uploadDir))) throw new BackupError(`${opts.uploadDir} is not empty. A restore never overwrites files: point UPLOAD_DIR at an empty folder.`);

  const pool = new Pool({
    connectionString: opts.databaseUrl, max: 1, connectionTimeoutMillis: 10_000,
    ssl: opts.ssl?.enabled ? { rejectUnauthorized: true, ...(opts.ssl.ca ? { ca: opts.ssl.ca } : {}) } : undefined,
  });
  pool.on('error', () => {});
  try {
    const objects = await pool.query<{ n: string }>(
      `select count(*) as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and s.nspname not like 'pg_temp%' and s.nspname not like 'pg_toast_temp%'
         and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')`).catch((err: Error) => { throw new BackupError(`Cannot connect to the database: ${err.message}`); });
    if (Number(objects.rows[0]!.n) > 0) {
      throw new BackupError(`Database "${target.database}" already has tables. A restore only goes into an empty database: create a new one, or drop and recreate this one yourself.`);
    }

    // One transaction and stop at the first error: a failed restore leaves the database as empty as it was.
    await withConnection(opts.databaseUrl, opts.ssl, (connection) => runTool({
      bin: opts.pgRestoreBin ?? process.env.PG_RESTORE_BIN ?? 'pg_restore', env: connection.env, input: fs.createReadStream(dumpFile),
      args: ['--single-transaction', '--exit-on-error', '--no-owner', '--no-acl', `--dbname=${connection.database}`],
      what: 'pg_restore',
    }));
    log('database restored');

    let extracted = 0;
    if (uploadsFile) {
      try {
        extracted = await extractUploadsArchive(uploadsFile, opts.uploadDir, opts.tarBin);
      } catch (err) {
        // the folder was empty before, so everything in it is ours to remove
        for (const name of await fsp.readdir(opts.uploadDir).catch(() => [])) await fsp.rm(path.join(opts.uploadDir, name), { recursive: true, force: true });
        throw new BackupError(`The database was restored but the uploads were not: ${err instanceof Error ? err.message : String(err)}\nDrop the database, fix the cause and run the restore again.`);
      }
      log(`uploads extracted (${extracted} files)`);
    }

    const integrity = await verifyRestore(pool, opts.uploadDir, manifest, extracted);
    return { manifest, integrity };
  } finally {
    await pool.end();
  }
}

import fsp from 'node:fs/promises';
import path from 'node:path';
import { Pool, type PoolClient } from 'pg';
import {
  BACKUP_FORMAT, BackupError, backupName, DUMP_FILE, MANIFEST_FILE, PARTIAL_SUFFIX, rotateBackups, UPLOADS_FILE, type BackupManifest,
} from './backupLayout.js';
import { runTool, withConnection, writeHashed, type DatabaseSsl } from './postgresTools.js';
import { createUploadsArchive } from './uploadsArchive.js';

// Order matters here, and it is the whole consistency story:
//
//  1. Open a repeatable-read transaction and export its snapshot. The table
//     counts and the list of file ids are read inside it, and pg_dump is told to
//     dump that same snapshot, so the dump, the counts and the ids describe one
//     instant even while people keep chatting.
//  2. Only then archive the uploads. A file is written before the row that
//     points at it, so every row in the snapshot has its file on disk by now.
//     The reverse order would archive first and dump later, and a message sent in
//     between would point at a file the archive never saw.
//  3. What can still differ is a file deleted after the snapshot (someone removed
//     a message). It is counted in the manifest and shows up as a warning on restore.
//     Files uploaded after the snapshot just end up in the archive without a row;
//     the orphan sweep collects them after its grace period.

export interface BackupOptions {
  databaseUrl: string;
  ssl?: DatabaseSsl;
  uploadDir: string;
  backupDir: string;
  keep: number;
  pgDumpBin?: string;
  tarBin?: string;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface BackupResult { dir: string; manifest: BackupManifest; removed: string[] }

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;

interface Snapshot {
  id: string;
  databaseName: string;
  serverVersion: string;
  migrations: number;
  tables: Record<string, number>;
  /** Every id that must have a file: attachments (thumbnails included), staged files and their thumbnails, sound files. */
  fileIds: string[];
}

async function readSnapshot(client: PoolClient): Promise<Snapshot> {
  await client.query('begin isolation level repeatable read read only');
  const head = (await client.query<{ id: string; db: string; version: string }>(
    "select pg_export_snapshot() as id, current_database() as db, current_setting('server_version') as version")).rows[0]!;
  const tableNames = (await client.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1")).rows.map((r) => r.table_name);
  const tables: Record<string, number> = {};
  for (const name of tableNames) {
    tables[name] = Number((await client.query<{ n: string }>(`select count(*) as n from public.${quoteIdent(name)}`)).rows[0]!.n);
  }
  // Drizzle's own bookkeeping lives outside `public`; if it came across incomplete, the next boot would re-run migrations.
  const migrationsTable = (await client.query<{ r: string | null }>("select to_regclass('drizzle.__drizzle_migrations') as r")).rows[0]!.r;
  const migrations = migrationsTable ? Number((await client.query<{ n: string }>('select count(*) as n from drizzle.__drizzle_migrations')).rows[0]!.n) : 0;
  const ids = await client.query<{ id: string }>(
    `select id from attachments
     union select id from server_sounds
     union select id from server_emojis
     union select id from server_stickers
     union select id from staged_attachments
     union select thumb_id from staged_attachments where thumb_id is not null`);
  return { id: head.id, databaseName: head.db, serverVersion: head.version, migrations, tables, fileIds: ids.rows.map((r) => r.id) };
}

export async function createBackup(opts: BackupOptions): Promise<BackupResult> {
  const log = opts.log ?? (() => {});
  const backupDir = path.resolve(opts.backupDir);
  const uploadDir = path.resolve(opts.uploadDir);
  // an archive of the uploads folder that contains the backups would grow with every run
  if (backupDir === uploadDir || backupDir.startsWith(uploadDir + path.sep)) {
    throw new BackupError(`BACKUP_DIR (${backupDir}) is inside the uploads folder (${uploadDir}); every backup would contain the previous ones. Use another folder.`);
  }
  const name = backupName((opts.now ?? (() => new Date()))());
  const finalDir = path.join(backupDir, name);
  const partialDir = finalDir + PARTIAL_SUFFIX;
  await fsp.mkdir(backupDir, { recursive: true });
  if (await fsp.stat(finalDir).then(() => true, () => false)) throw new BackupError(`${finalDir} already exists (two backups in the same second?).`);
  await fsp.mkdir(partialDir, { mode: 0o700 }).catch((err: NodeJS.ErrnoException) => {
    throw err.code === 'EEXIST' ? new BackupError(`${partialDir} exists: another backup is running, or one crashed (it is removed after 24 hours).`) : err;
  });

  try {
    const pool = new Pool({
      connectionString: opts.databaseUrl, max: 1, connectionTimeoutMillis: 10_000,
      ssl: opts.ssl?.enabled ? { rejectUnauthorized: true, ...(opts.ssl.ca ? { ca: opts.ssl.ca } : {}) } : undefined,
    });
    pool.on('error', () => {});
    let snapshot: Snapshot;
    let dump: Awaited<ReturnType<typeof writeHashed>>;
    let dumpTool = '';
    const client = await pool.connect().catch((err: Error) => { throw new BackupError(`Cannot connect to the database: ${err.message}`); });
    try {
      snapshot = await readSnapshot(client);
      log(`snapshot of "${snapshot.databaseName}": ${Object.keys(snapshot.tables).length} tables, ${snapshot.migrations} migrations`);
      const pgDump = opts.pgDumpBin ?? process.env.PG_DUMP_BIN ?? 'pg_dump';
      dumpTool = (await runTool({ bin: pgDump, args: ['--version'], what: 'pg_dump' })).stdout.trim();
      dump = await withConnection(opts.databaseUrl, opts.ssl, (connection) => writeHashed(
        (sink) => runTool({
          bin: pgDump, env: connection.env, output: sink, what: 'pg_dump',
          args: ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot.id}`],
        }),
        path.join(partialDir, DUMP_FILE),
      ));
      log(`database dumped (${dump.bytes} bytes)`);
    } finally {
      // the snapshot is only needed while pg_dump runs; do not hold it through a long archive
      await client.query('commit').catch(() => {});
      client.release();
      await pool.end();
    }

    const archive = await createUploadsArchive(uploadDir, path.join(partialDir, UPLOADS_FILE), opts.tarBin);
    if (archive.sha256) await fsp.chmod(path.join(partialDir, UPLOADS_FILE), 0o600);
    log(`uploads archived (${archive.files} files, ${archive.bytes} bytes)`);
    const missingFromArchive = snapshot.fileIds.filter((id) => !archive.storedNames.has(id)).length;
    if (missingFromArchive > 0) log(`warning: ${missingFromArchive} file(s) referenced by the database were not on disk when the archive was made`);

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      database: { name: snapshot.databaseName, serverVersion: snapshot.serverVersion, dumpTool },
      migrations: snapshot.migrations,
      tables: snapshot.tables,
      uploads: { files: archive.files, bytes: archive.bytes, missingFromArchive },
      sha256: { dump: dump.sha256, uploads: archive.sha256 },
    };
    await fsp.writeFile(path.join(partialDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    // the rename is what makes it a backup: until then rotation and restore do not see it
    await fsp.rename(partialDir, finalDir);
    const removed = await rotateBackups(backupDir, opts.keep);
    if (removed.length > 0) log(`rotation removed ${removed.join(', ')}`);
    return { dir: finalDir, manifest, removed };
  } catch (err) {
    await fsp.rm(partialDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

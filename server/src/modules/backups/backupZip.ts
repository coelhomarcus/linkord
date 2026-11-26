import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Transform, type Readable, type Writable } from 'node:stream';
import { finished, pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { Pool, type PoolClient } from 'pg';
import yazl from 'yazl';
import {
  BACKUP_FORMAT, BackupError, DUMP_FILE, MANIFEST_FILE, README_FILE, UPLOADS_PREFIX, UploadsDigest, type BackupManifest,
} from './backupLayout.js';
import { runTool, withConnection, type DatabaseSsl } from './postgresTools.js';
import { isStoredFileName, listUploadFiles } from './uploadsArchive.js';

// A backup is one ZIP written straight to a stream (an HTTP response, stdout, a
// file the CLI was told to write); the server never keeps one. Order matters,
// and it is the whole consistency story:
//
//  1. Open a repeatable-read transaction and export its snapshot. The table
//     counts and the list of file ids are read inside it, and pg_dump is told to
//     dump that same snapshot, so the dump, the counts and the ids describe one
//     instant even while people keep chatting.
//  2. Only after the dump, add the uploads. A file is written before the row
//     that points at it, so every row in the snapshot has its file on disk by now.
//     The reverse order would archive first and dump later, and a message sent in
//     between would point at a file the archive never saw.
//  3. What can still differ is a file deleted after the snapshot (someone removed
//     a message). It is left out, counted in the manifest and shows up as a
//     warning on restore. Files uploaded after the snapshot end up in the ZIP
//     without a row; the orphan sweep collects them after its grace period.
//
// Nothing is compressed: the dump is already compressed by pg_dump and media
// files are images, video and audio. The manifest comes last because it holds
// the checksums of everything before it.

export interface BackupZipOptions {
  databaseUrl: string;
  ssl?: DatabaseSsl;
  uploadDir: string;
  pgDumpBin?: string;
  now?: () => Date;
  /** Abort to stop (a download the person cancelled): pg_dump is killed and the output destroyed. */
  signal?: AbortSignal;
  log?: (message: string) => void;
}

export interface BackupZipResult { manifest: BackupManifest; bytes: number }

const quoteIdent = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const openFile = promisify(fs.open);
const fstat = promisify(fs.fstat);
const closeFile = promisify(fs.close);

const README = `This is a full backup of an Overcord instance: its database and every stored file.

database.dump    the PostgreSQL database (pg_dump, custom format)
uploads/         the stored files (attachments, avatars, emojis, stickers, sounds)
manifest.json    row counts, file counts and checksums, checked by the restore

It holds password hashes, sessions and every message. Keep it like the database
itself, and encrypt it when it leaves the machine. It does not hold the .env
(database credentials, LiveKit and Web Push keys): keep that in a secrets store.

To restore it, with the app stopped, into an empty database and uploads folder:

  bun run restore <this file>.zip --confirm <database name>

See "Backups" in docs/DEPLOY.md.
`;

interface Snapshot {
  id: string;
  databaseName: string;
  serverVersion: string;
  migrations: number;
  tables: Record<string, number>;
  /** Every id that must have a file: attachments (thumbnails included), staged files and their thumbnails, sounds, emojis, stickers. */
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

/** A pass-through that feeds every chunk to `onChunk`. Backpressure flows through it, so a slow download
 * slows pg_dump and the file reads instead of filling memory. */
function tap(onChunk: (chunk: Buffer) => void): Transform {
  return new Transform({ transform(chunk: Buffer, _encoding, done) { onChunk(chunk); done(null, chunk); } });
}

/** Adds `source` as the next entry and resolves once the ZIP has read all of it. */
function addEntry(zip: yazl.ZipFile, source: Readable, name: string, options: Partial<yazl.ReadStreamOptions>, signal: AbortSignal): Promise<void> {
  zip.addReadStream(source, name, options);
  return finished(source, { writable: false, signal });
}

async function addDatabase(zip: yazl.ZipFile, opts: BackupZipOptions, mtime: Date, signal: AbortSignal, log: (message: string) => void) {
  const pool = new Pool({
    connectionString: opts.databaseUrl, max: 1, connectionTimeoutMillis: 10_000,
    ssl: opts.ssl?.enabled ? { rejectUnauthorized: true, ...(opts.ssl.ca ? { ca: opts.ssl.ca } : {}) } : undefined,
  });
  pool.on('error', () => {});
  const client = await pool.connect().catch(async (err: Error) => {
    await pool.end().catch(() => {});
    throw new BackupError(`Cannot connect to the database: ${err.message}`);
  });
  try {
    const snapshot = await readSnapshot(client);
    log(`snapshot of "${snapshot.databaseName}": ${Object.keys(snapshot.tables).length} tables, ${snapshot.migrations} migrations`);
    const pgDump = opts.pgDumpBin ?? process.env.PG_DUMP_BIN ?? 'pg_dump';
    const dumpTool = (await runTool({ bin: pgDump, args: ['--version'], what: 'pg_dump', signal })).stdout.trim();
    const hash = crypto.createHash('sha256');
    let bytes = 0;
    const dumpStream = tap((chunk) => { hash.update(chunk); bytes += chunk.length; });
    const read = addEntry(zip, dumpStream, DUMP_FILE, { mtime, compress: false }, signal);
    read.catch(() => {});
    await withConnection(opts.databaseUrl, opts.ssl, (connection) => runTool({
      bin: pgDump, env: connection.env, output: dumpStream, what: 'pg_dump', signal,
      args: ['--format=custom', '--no-owner', '--no-acl', `--snapshot=${snapshot.id}`],
    }));
    await read;
    log(`database dumped (${bytes} bytes)`);
    return { snapshot, dumpTool, dump: { sha256: hash.digest('hex'), bytes } };
  } finally {
    // the snapshot is only needed while pg_dump runs; do not hold it while the files stream
    await client.query('commit').catch(() => {});
    client.release();
    await pool.end();
  }
}

async function addUploads(zip: yazl.ZipFile, uploadDir: string, signal: AbortSignal) {
  const digest = new UploadsDigest();
  const stored = new Set<string>();
  let files = 0;
  let bytes = 0;
  for (const relative of await listUploadFiles(uploadDir)) {
    signal.throwIfAborted();
    // Opened before it is added: a file deleted since the listing is skipped, and once open it can be
    // read whole even if it is deleted meanwhile.
    let fd: number;
    try {
      fd = await openFile(path.join(uploadDir, relative), 'r');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw err;
    }
    let owned = true;
    let size: number;
    try {
      const stat = await fstat(fd);
      if (!stat.isFile()) continue;
      size = stat.size;
      digest.begin(relative, stat.size);
      const source = fs.createReadStream('', { fd, autoClose: true });
      owned = false;
      const through = tap((chunk) => digest.update(chunk));
      const read = addEntry(zip, through, `${UPLOADS_PREFIX}${relative}`, { mtime: stat.mtime, compress: false, size: stat.size }, signal);
      read.catch(() => {});
      await Promise.all([pipeline(source, through, { signal }), read]);
    } finally {
      if (owned) await closeFile(fd).catch(() => {});
    }
    files++;
    bytes += size;
    if (isStoredFileName(relative)) stored.add(relative);
  }
  return { files, bytes, stored, sha256: digest.digest() };
}

/** Writes a full backup to `out` as a ZIP. On failure `out` is destroyed, so a download ends as failed instead
 * of as a ZIP that looks complete; the caller removes anything it wrote to disk. */
export async function writeBackupZip(out: Writable, opts: BackupZipOptions): Promise<BackupZipResult> {
  const log = opts.log ?? (() => {});
  const stop = new AbortController();
  const fail = (reason: unknown) => { if (!stop.signal.aborted) stop.abort(reason); };
  const cancelled = () => fail(new BackupError('The backup was cancelled.'));
  if (opts.signal?.aborted) cancelled();
  opts.signal?.addEventListener('abort', cancelled, { once: true });

  const zip = new yazl.ZipFile();
  let written = 0;
  const output = pipeline(zip.outputStream, tap((chunk) => { written += chunk.length; }), out);
  output.catch(fail);
  try {
    stop.signal.throwIfAborted();
    const mtime = (opts.now ?? (() => new Date()))();
    zip.addBuffer(Buffer.from(README), README_FILE, { mtime });
    const { snapshot, dumpTool, dump } = await addDatabase(zip, opts, mtime, stop.signal, log);
    const uploads = await addUploads(zip, path.resolve(opts.uploadDir), stop.signal);
    log(`uploads added (${uploads.files} files, ${uploads.bytes} bytes)`);
    const missingFromArchive = snapshot.fileIds.filter((id) => !uploads.stored.has(id)).length;
    if (missingFromArchive > 0) log(`warning: ${missingFromArchive} file(s) referenced by the database were not on disk when the backup was made`);

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      createdAt: new Date().toISOString(),
      database: { name: snapshot.databaseName, serverVersion: snapshot.serverVersion, dumpTool },
      migrations: snapshot.migrations,
      tables: snapshot.tables,
      uploads: { files: uploads.files, bytes: uploads.bytes, missingFromArchive },
      sha256: { dump: dump.sha256, uploads: uploads.sha256 },
    };
    zip.addBuffer(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), MANIFEST_FILE, { mtime });
    zip.end();
    await output;
    return { manifest, bytes: written };
  } catch (err) {
    fail(err);
    (zip.outputStream as Readable).destroy();
    out.destroy();
    await output.catch(() => {});
    throw stop.signal.reason ?? err;
  } finally {
    opts.signal?.removeEventListener('abort', cancelled);
  }
}

/** The CLI's way: written next to `file` and renamed when complete, so a file with the final name is always a
 * finished backup. Never overwrites. */
export async function writeBackupFile(file: string, opts: BackupZipOptions): Promise<BackupZipResult> {
  const partial = `${file}.partial`;
  if (await fsp.stat(file).then(() => true, () => false)) throw new BackupError(`${file} already exists.`);
  const fd = await openFile(partial, 'wx', 0o600).catch((err: NodeJS.ErrnoException) => {
    throw err.code === 'EEXIST' ? new BackupError(`${partial} exists: another backup is being written there, or one was interrupted (delete it).`) : err;
  });
  const out = fs.createWriteStream('', { fd, autoClose: true });
  try {
    const result = await writeBackupZip(out, opts);
    await fsp.rename(partial, file);
    return result;
  } catch (err) {
    await fsp.rm(partial, { force: true }).catch(() => {});
    throw err;
  }
}

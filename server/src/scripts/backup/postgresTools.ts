import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, type Readable, type Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BackupError } from './backupLayout.js';

// pg_dump, pg_restore and tar are run as child processes. The connection goes
// through PG* environment variables, never the command line, so the password is
// not visible in `ps`; data goes through stdin/stdout, so PG_DUMP_BIN and
// PG_RESTORE_BIN can point at a wrapper that runs the tool somewhere else (for
// example `docker exec -i <postgres container> pg_dump "$@"`).

export interface DatabaseSsl { enabled: boolean; ca?: string }

export interface PgConnection {
  env: Record<string, string>;
  host: string;
  port: string;
  database: string;
}

/** Same trust rules as the app's pool (`db/client.ts`): with TLS on, the
 * certificate is always verified, against `DATABASE_SSL_CA` when one is pinned. */
export function pgConnection(databaseUrl: string, ssl: DatabaseSsl = { enabled: false }, caFile?: string): PgConnection {
  let url: URL;
  try { url = new URL(databaseUrl); } catch { throw new BackupError('DATABASE_URL is not a valid URL.'); }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new BackupError('DATABASE_URL must start with postgres://.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) throw new BackupError('DATABASE_URL does not name a database.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const port = url.port || '5432';
  const env: Record<string, string> = { PGHOST: host, PGPORT: port, PGDATABASE: database };
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  if (ssl.enabled) {
    env.PGSSLMODE = 'verify-full';
    if (caFile) env.PGSSLROOTCERT = caFile;
  }
  return { env, host, port, database };
}

/** Writes a pinned CA to a private temp file for the tools, which only read one from a path. */
export async function withConnection<T>(databaseUrl: string, ssl: DatabaseSsl | undefined, run: (connection: PgConnection) => Promise<T>): Promise<T> {
  if (!ssl?.enabled || !ssl.ca) return run(pgConnection(databaseUrl, ssl));
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'linkord-pg-'));
  try {
    const caFile = path.join(dir, 'ca.pem');
    await fsp.writeFile(caFile, ssl.ca, { mode: 0o600 });
    return await run(pgConnection(databaseUrl, ssl, caFile));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

export interface ToolRun {
  bin: string;
  args: string[];
  env?: Record<string, string>;
  /** Fed to the tool's stdin. */
  input?: Readable;
  /** Receives the tool's stdout. Without it, stdout is collected and returned. */
  output?: Writable;
  /** Exit codes that count as success (default: 0 only). */
  okCodes?: number[];
  what: string;
}

const STDERR_LIMIT = 8_000;

export async function runTool(run: ToolRun): Promise<{ stdout: string; stderr: string; code: number }> {
  const child = spawn(run.bin, run.args, { env: { ...process.env, ...run.env }, stdio: [run.input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
  const { stdout: childOut, stderr: childErr } = child as typeof child & { stdout: Readable; stderr: Readable };
  let stderr = '';
  childErr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_LIMIT); });
  const spawned = new Promise<number>((resolve, reject) => {
    child.once('error', (err) => {
      reject((err as NodeJS.ErrnoException).code === 'ENOENT'
        ? new BackupError(`${run.what}: "${run.bin}" was not found. Install it (the PostgreSQL client tools for pg_dump and pg_restore) or set PG_DUMP_BIN / PG_RESTORE_BIN to its path.`)
        : err);
    });
    child.once('close', (code) => resolve(code ?? -1));
  });
  let stdout = '';
  const streams: Promise<unknown>[] = [];
  if (run.output) streams.push(pipeline(childOut, run.output));
  else {
    childOut.setEncoding('utf8');
    childOut.on('data', (chunk: string) => { stdout += chunk; });
  }
  // The tool may exit before reading all of its input (a failed restore); the EPIPE that follows is not the real error.
  if (run.input) streams.push(pipeline(run.input, child.stdin!).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw err; }));
  const settled = await Promise.allSettled([spawned, ...streams]);
  const code = settled[0]!.status === 'fulfilled' ? settled[0].value : undefined;
  if (code === undefined) throw (settled[0] as PromiseRejectedResult).reason;
  if (!(run.okCodes ?? [0]).includes(code)) {
    throw new BackupError(`${run.what} failed (exit ${code}).${stderr.trim() ? `\n${stderr.trim()}` : ''}`);
  }
  const failedStream = settled.slice(1).find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (failedStream) throw failedStream.reason;
  return { stdout, stderr, code };
}

export interface FileDigest { sha256: string; bytes: number }

/** Copies a stream into `file` while hashing it, so a dump is never read twice. */
export async function writeHashed(source: (sink: Writable) => Promise<unknown>, file: string): Promise<FileDigest> {
  const hash = crypto.createHash('sha256');
  const tap = new PassThrough();
  let bytes = 0;
  tap.on('data', (chunk: Buffer) => { hash.update(chunk); bytes += chunk.length; });
  const written = pipeline(tap, fs.createWriteStream(file, { flags: 'wx', mode: 0o600 }));
  try {
    await source(tap);
  } catch (err) {
    tap.destroy();
    await written.catch(() => {});
    throw err;
  }
  await written;
  return { sha256: hash.digest('hex'), bytes };
}

export async function sha256OfFile(file: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

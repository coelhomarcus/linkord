import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../../db/client.js';
import { sendError } from '../../http/respond.js';
import { logger } from '../../lib/logger.js';
import { requireAdmin } from '../admin/adminAuth.js';
import { listAudit, recordAudit, recordAuditFailure, type AuditActor, type AuditRow } from '../admin/auditLog.js';
import { getUsage } from '../attachments/attachmentQuota.js';
import { backupFileName } from './backupLayout.js';
import { runTool } from './postgresTools.js';

const log = logger.child({ component: 'backup' });

// A full backup downloaded from the admin site. The ZIP is built while it
// downloads (backupZip.ts) and never stored. Getting it takes two steps:
//   1. POST /api/admin/backup/download, a mutating admin action (origin check,
//      rate limit, written reason), returns a link with a random token;
//   2. GET on that link streams the ZIP. A plain link is what a browser can
//      download, but GETs are not origin-checked and the admin cookie is
//      SameSite=Lax, so the token is what proves the admin asked for it: it
//      works once, for one minute, and only for the admin it was issued to.
// One backup runs at a time (this is a single-instance app): a second would
// double the load on the database and the disk for nothing.
//
// The ZIP is written by `scripts/backup.js` in a child process and its stdout is
// forwarded to the response. Checksumming every byte (yazl's CRC-32 is plain
// JavaScript) would otherwise run on the event loop that serves chat and calls.

export const BACKUP_AUDIT_ACTION = 'system.backup_download';
const TOKEN_TTL_MS = 60_000;
const RECENT_DOWNLOADS = 5;

interface PendingDownload { actor: AuditActor; reason: string; expiresAt: number }

const pending = new Map<string, PendingDownload>();
let running: { actor: AuditActor; startedAt: number } | null = null;

const pgDumpBin = () => process.env.PG_DUMP_BIN ?? 'pg_dump';

// compiled, server/dist/modules/backups -> server/dist/scripts/backup.js; from source, the .ts beside it
const here = fileURLToPath(import.meta.url);
const BACKUP_SCRIPT = path.join(path.dirname(here), '..', '..', 'scripts', `backup${path.extname(here)}`);
const STDERR_LIMIT = 4_000;

/** What the script said when it failed: its "Backup failed: …" message (which may span lines, such as
 * pg_dump's own error under it), or its last line. */
function failureMessage(stderr: string): string {
  const at = stderr.lastIndexOf('Backup failed: ');
  if (at >= 0) return stderr.slice(at + 'Backup failed: '.length).trim().replace(/\s*\n\s*/g, ' ');
  return stderr.trim().split('\n').at(-1)?.trim() ?? '';
}

/** Whether pg_dump runs here, checked before a link is issued and again before it is spent, so a server
 * without it says so on the page instead of failing mid-download. */
export async function pgDumpAvailable(): Promise<boolean> {
  return runTool({ bin: pgDumpBin(), args: ['--version'], what: 'pg_dump' }).then(() => true, () => false);
}

export interface BackupInfo {
  available: boolean;
  running: { by: string; startedAt: string } | null;
  /** What the ZIP will roughly weigh: the database on disk (the dump is usually smaller) plus the stored files. */
  estimate: { databaseBytes: number; uploadsBytes: number; files: number };
  recent: AuditRow[];
}

export async function getBackupInfo(): Promise<BackupInfo> {
  const [available, database, usage, audit] = await Promise.all([
    pgDumpAvailable(),
    db.execute<{ bytes: string }>(sql`select pg_database_size(current_database())::text as bytes`),
    getUsage(),
    listAudit({ action: BACKUP_AUDIT_ACTION }),
  ]);
  return {
    available,
    running: running ? { by: running.actor.username, startedAt: new Date(running.startedAt).toISOString() } : null,
    estimate: { databaseBytes: Number(database.rows[0]?.bytes ?? 0), uploadsBytes: usage.totalBytes, files: usage.totalFiles },
    recent: audit === 'invalid_cursor' ? [] : audit.items.slice(0, RECENT_DOWNLOADS),
  };
}

export type IssueResult = { code: 'ok'; token: string; expiresAt: Date } | { code: 'busy' };

/** A one-time link for `actor`. A newer link replaces any the same admin still had. */
export function issueDownloadToken(actor: AuditActor, reason: string, now = Date.now()): IssueResult {
  if (running) return { code: 'busy' };
  for (const [token, entry] of pending) if (entry.expiresAt <= now || entry.actor.id === actor.id) pending.delete(token);
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = now + TOKEN_TTL_MS;
  pending.set(token, { actor, reason, expiresAt });
  return { code: 'ok', token, expiresAt: new Date(expiresAt) };
}

export type ClaimResult = { code: 'ok'; reason: string } | { code: 'expired' } | { code: 'busy' };

/** Spends `token` and takes the lock, in one synchronous step so two requests cannot both start. */
export function claimDownload(token: string, actor: AuditActor, now = Date.now()): ClaimResult {
  const entry = pending.get(token);
  if (!entry || entry.actor.id !== actor.id) return { code: 'expired' };
  pending.delete(token);
  if (entry.expiresAt <= now) return { code: 'expired' };
  if (running) return { code: 'busy' };
  running = { actor, startedAt: now };
  return { code: 'ok', reason: entry.reason };
}

export function releaseDownload(): void {
  running = null;
}

/** GET /api/admin/backup/download/:token */
export async function handleBackupDownload(request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply): Promise<unknown> {
  const actor = await requireAdmin(request, reply);
  if (!actor) return;
  if (!(await pgDumpAvailable())) return sendError(reply, 503, 'backup_unavailable', 'O servidor não tem o pg_dump instalado; não é possível gerar o backup.');
  const claim = claimDownload(String(request.params.token || ''), actor);
  if (claim.code === 'expired') return sendError(reply, 404, 'backup_link_expired', 'Este link de backup expirou ou já foi usado. Peça um novo.');
  if (claim.code === 'busy') return sendError(reply, 409, 'backup_running', 'Outro backup está sendo baixado. Espere ele terminar.');

  const started = Date.now();
  const entry = { actor, action: BACKUP_AUDIT_ACTION, targetType: 'system' as const, reason: claim.reason, requestId: request.id };
  try {
    // the trail is written before the first byte leaves, so even a download cut short by a crash is on it
    await recordAudit(entry);
  } catch (err) {
    releaseDownload();
    throw err;
  }

  const body = new PassThrough();
  const child = spawn(process.execPath, ['--no-env-file', BACKUP_SCRIPT], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let bytes = 0;
  let stderr = '';
  let ended = false;
  log.info('backup download started', { reqId: request.id, admin: actor.username, pid: child.pid });
  // not `pipe`'s own end: a failed run must destroy the body, so the download ends as failed, not as a short ZIP
  child.stdout.on('data', (chunk: Buffer) => { bytes += chunk.length; });
  child.stdout.pipe(body, { end: false });
  child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-STDERR_LIMIT); });
  // the person closed the tab, or Fastify gave up on the response: stop the script, which stops pg_dump
  body.on('close', () => { if (!ended) child.kill('SIGTERM'); });

  const finish = async (err: Error | null) => {
    if (ended) return;
    ended = true;
    const ms = Date.now() - started;
    try {
      if (!err) {
        body.end();
        log.info('backup download finished', { reqId: request.id, bytes, ms });
        return;
      }
      body.destroy(err);
      // a person closing the tab ends up here too; the trail says which
      log.warn('backup download failed', { reqId: request.id, bytes, ms, err });
      await recordAuditFailure({ ...entry, detail: { ms, bytes } }, err);
    } finally {
      releaseDownload();
    }
  };
  child.once('error', (err) => { void finish(err); });
  child.once('close', (code, signal) => {
    const message = failureMessage(stderr);
    void finish(code === 0 ? null : new Error(message || `the backup script stopped (${signal ?? `exit ${code}`})`));
  });

  // see attachmentServing.ts: returning the reply keeps Fastify from racing in an empty response
  return reply
    .code(200)
    .header('Content-Type', 'application/zip')
    .header('Content-Disposition', `attachment; filename="${backupFileName(new Date(started))}"`)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'no-store')
    .send(body);
}

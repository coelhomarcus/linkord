import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { dataExports, users } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { recordAudit, recordAuditFailure, type AuditActor } from '../admin/auditLog.js';
import { isEmailDeliveryConfigured, sendDataExportReadyEmail } from '../auth/email.js';
import { resolveLocale } from '../users/locale.js';
import { writeExportArchive } from './exportArchive.js';
import { deleteExportFiles, ensureExportDir, exportFilePath, exportIdOfFile } from './exportStorage.js';

const log = logger.child({ component: 'data-export' });

// "Download my data" (LGPD): a request becomes a `data_exports` row; a background job builds its ZIP
// (exportArchive.ts) into EXPORT_DIR and emails a link to it. The file can be downloaded by the same
// account until DATA_EXPORT_TTL_MS, then the sweep deletes it. One request per DATA_EXPORT_INTERVAL_MS.

type ExportRow = typeof dataExports.$inferSelect;

export interface ExportStatus {
  id: string;
  status: 'pending' | 'running' | 'ready' | 'failed' | 'expired';
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  sizeBytes: number | null;
}

const toStatus = (row: ExportRow): ExportStatus => ({
  id: row.id,
  status: row.status as ExportStatus['status'],
  requestedAt: row.requestedAt.toISOString(),
  completedAt: row.completedAt?.toISOString() ?? null,
  expiresAt: row.expiresAt?.toISOString() ?? null,
  sizeBytes: row.sizeBytes ?? null,
});

/** The link in the email and the settings page: the file, for the signed-in account only. */
const downloadPath = (id: string) => `/api/account/data-export/${id}/download`;

/** A ready export past its expiry reads as expired even before the sweep gets to it. */
function effective(row: ExportRow, now: Date): ExportRow {
  return row.status === 'ready' && row.expiresAt && row.expiresAt <= now ? { ...row, status: 'expired' } : row;
}

/** When the account may ask again: a failed request does not count, so a broken job never locks anyone out. */
function nextRequestAt(latest: ExportRow | undefined): Date | null {
  if (!latest || latest.status === 'failed') return null;
  return new Date(latest.requestedAt.getTime() + config.DATA_EXPORT_INTERVAL_MS);
}

async function latestExport(userId: string): Promise<ExportRow | undefined> {
  const [row] = await db.select().from(dataExports).where(eq(dataExports.userId, userId)).orderBy(desc(dataExports.requestedAt)).limit(1);
  return row;
}

export async function getExportStatus(userId: string, now = new Date()): Promise<{ latest: ExportStatus | null; nextRequestAt: string | null }> {
  const latest = await latestExport(userId);
  const next = nextRequestAt(latest);
  return {
    latest: latest ? toStatus(effective(latest, now)) : null,
    nextRequestAt: next && next > now ? next.toISOString() : null,
  };
}

export type RequestResult = { code: 'ok'; export: ExportStatus } | { code: 'rate_limited'; retryAt: Date };

/** Queues an export, unless the account asked for one within the interval. The check and the insert run
 * under the account's row lock, so two clicks at once queue one. */
export async function requestDataExport(actor: AuditActor, requestId: string, now = new Date()): Promise<RequestResult> {
  const result = await db.transaction(async (tx): Promise<RequestResult> => {
    await tx.execute(sql`select id from users where id = ${actor.id} for update`);
    const [latest] = await tx.select().from(dataExports).where(eq(dataExports.userId, actor.id)).orderBy(desc(dataExports.requestedAt)).limit(1);
    const next = nextRequestAt(latest);
    if (next && next > now) return { code: 'rate_limited', retryAt: next };
    const [row] = await tx.insert(dataExports).values({ id: crypto.randomUUID(), userId: actor.id, requestedAt: now }).returning();
    await recordAudit({ actor, action: 'account.data_export_request', targetType: 'user', targetId: actor.id, targetLabel: actor.username, requestId }, tx);
    return { code: 'ok', export: toStatus(row!) };
  });
  if (result.code === 'ok') kickExportJob();
  return result;
}

export type DownloadLookup = { code: 'ok'; file: string; fileName: string; sizeBytes: number } | { code: 'not_found' | 'expired' };

/** The file of an export of `userId`'s, if it can still be downloaded. Another account's export reads as
 * missing, never as forbidden. */
export async function findDownload(userId: string, id: string, now = new Date()): Promise<DownloadLookup> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return { code: 'not_found' };
  const [row] = await db.select({ e: dataExports, username: users.username }).from(dataExports)
    .innerJoin(users, eq(users.id, dataExports.userId))
    .where(and(eq(dataExports.id, id), eq(dataExports.userId, userId))).limit(1);
  if (!row) return { code: 'not_found' };
  const e = effective(row.e, now);
  if (e.status === 'expired') return { code: 'expired' };
  if (e.status !== 'ready') return { code: 'not_found' };
  // a restored backup has the row without the file (backups leave exports out)
  const file = exportFilePath(e.id);
  if (!(await fs.stat(file).then((st) => st.isFile(), () => false))) return { code: 'not_found' };
  const day = (e.completedAt ?? e.requestedAt).toISOString().slice(0, 10);
  return { code: 'ok', file, fileName: `linkord-${row.username}-${day}.zip`, sizeBytes: e.sizeBytes ?? 0 };
}

// ---- the job ----

let running: Promise<void> | null = null;
let again = false;

/** Starts the job if it is not running; if it is, it takes one more look before stopping, so a request
 * that lands while it finishes its last export is not left waiting for the next tick. */
export function kickExportJob(): void {
  if (running) { again = true; return; }
  running = (async () => {
    try {
      do {
        again = false;
        while (await buildNextExport()) { /* one export at a time */ }
      } while (again);
    } catch (err) {
      log.error('export job failed', err);
    } finally {
      running = null;
    }
  })();
}

/** Resolves once the job has nothing left to do (tests). */
export async function whenExportsIdle(): Promise<void> {
  while (running) await running;
}

/** Claims the oldest pending export and builds it. Returns false when there was none. */
async function buildNextExport(now = () => new Date()): Promise<boolean> {
  const [claimed] = await db.update(dataExports).set({ status: 'running', startedAt: now() })
    .where(eq(dataExports.id, sql`(select id from data_exports where status = 'pending' order by requested_at limit 1 for update skip locked)`))
    .returning();
  if (!claimed) return false;

  const destination = exportFilePath(claimed.id);
  const partial = `${destination}.part`;
  try {
    await ensureExportDir();
    const size = await writeExportArchive(claimed.userId, partial, now());
    if (size === null) {
      // the account was deleted while its export waited; the row went with it
      await fs.rm(partial, { force: true });
      return true;
    }
    await fs.rename(partial, destination);
    const done = now();
    const expiresAt = new Date(done.getTime() + config.DATA_EXPORT_TTL_MS);
    const [ready] = await db.update(dataExports).set({ status: 'ready', sizeBytes: size, completedAt: done, expiresAt })
      .where(eq(dataExports.id, claimed.id)).returning();
    if (!ready) {
      await deleteExportFiles([claimed.id]);
      return true;
    }
    log.info('data export ready', { exportId: claimed.id, userId: claimed.userId, bytes: size });
    await notifyReady(claimed.userId, claimed.id, expiresAt);
  } catch (err) {
    log.error('data export failed', err, { exportId: claimed.id, userId: claimed.userId });
    await fs.rm(partial, { force: true }).catch(() => {});
    await db.update(dataExports).set({ status: 'failed', completedAt: now() }).where(eq(dataExports.id, claimed.id));
    await recordAuditFailure({ actor: null, action: 'account.data_export', targetType: 'user', targetId: claimed.userId, detail: { exportId: claimed.id } }, err);
  }
  return true;
}

async function notifyReady(userId: string, exportId: string, expiresAt: Date): Promise<void> {
  const [user] = await db.select({ username: users.username, email: users.email, locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.email || !isEmailDeliveryConfigured() || !config.APP_URL) return;
  await sendDataExportReadyEmail({
    to: user.email, username: user.username, locale: resolveLocale(user.locale), link: `${config.APP_URL}${downloadPath(exportId)}`, expiresAt,
  }).catch((err) => log.warn('could not email the export link', { userId, exportId, err }));
}

/** At boot: an export the previous process was building never finished. It goes back in the queue (this
 * is a single-instance app; see docs/DEVELOPMENT.md on running several). */
export async function requeueInterruptedExports(): Promise<void> {
  const rows = await db.update(dataExports).set({ status: 'pending', startedAt: null }).where(eq(dataExports.status, 'running')).returning({ id: dataExports.id });
  if (rows.length > 0) log.info('interrupted data exports queued again', { count: rows.length });
}

// ---- cleanup ----

/** Expires ready exports past their time and deletes their files, and any file in EXPORT_DIR that no
 * ready export owns (an account deleted mid-build, a `.part` left by a crash). */
export async function sweepDataExports(now = new Date()): Promise<{ expired: number; removedFiles: number }> {
  const expired = await db.update(dataExports).set({ status: 'expired' })
    .where(and(eq(dataExports.status, 'ready'), lte(dataExports.expiresAt, now)))
    .returning({ id: dataExports.id });
  await deleteExportFiles(expired.map((e) => e.id));

  let names: string[];
  try {
    names = await fs.readdir(config.EXPORT_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { expired: expired.length, removedFiles: 0 };
    throw err;
  }
  const ids = names.map(exportIdOfFile).filter((id): id is string => id !== null);
  const kept = new Set(ids.length === 0 ? [] : (await db.select({ id: dataExports.id }).from(dataExports)
    .where(and(inArray(dataExports.id, ids), eq(dataExports.status, 'ready')))).map((r) => r.id));
  // a `.part` is being written by the job right now unless it is old
  const building = new Set((await db.select({ id: dataExports.id }).from(dataExports).where(eq(dataExports.status, 'running'))).map((r) => r.id));
  let removedFiles = 0;
  for (const name of names) {
    const id = exportIdOfFile(name);
    const partOf = name.endsWith('.zip.part') ? name.slice(0, -'.zip.part'.length) : null;
    const orphan = id ? !kept.has(id) : partOf !== null && !building.has(partOf);
    if (!orphan) continue;
    await fs.rm(path.join(config.EXPORT_DIR, name), { force: true });
    removedFiles++;
  }
  if (expired.length > 0 || removedFiles > 0) log.info('data exports swept', { expired: expired.length, removedFiles });
  return { expired: expired.length, removedFiles };
}

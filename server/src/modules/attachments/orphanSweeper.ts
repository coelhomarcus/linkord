import fs from 'node:fs/promises';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments, serverSounds } from '../../db/schema.js';
import { recordAudit, recordAuditFailure, type AuditActor } from '../admin/auditLog.js';
import { filePathFor } from './attachmentStorage.js';
import { classifyOrphans, FILE_ID_RE, type DiskFile } from './orphanClassification.js';
import { stagedFileIds } from './stagedAttachments.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'audit' });

// A failed unlink can leave a file after its database row is gone. Sweep old unreferenced files
// after a grace period so an upload being committed is not mistaken for an orphan.

export interface SweepResult {
  at: string;
  dryRun: boolean;
  scanned: number;
  orphanCount: number;
  orphanBytes: number;
  deleted: number;
  failed: number;
  recent: number;
  missingFiles: number;
}

let lastSweep: SweepResult | null = null;
export const getLastSweep = (): SweepResult | null => lastSweep;

async function listDiskFiles(): Promise<DiskFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(config.UPLOAD_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files: DiskFile[] = [];
  for (const name of names) {
    if (!FILE_ID_RE.test(name)) continue; // tmp/ and anything that isn't ours
    try {
      const stat = await fs.stat(filePathFor(name));
      if (stat.isFile()) files.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch { /* vanished while listing */ }
  }
  return files;
}

/** Thrown when a sweep is requested while another one is still running. */
export class SweepInProgressError extends Error {
  constructor() { super('Já existe uma varredura de arquivos em andamento.'); }
}

// One sweep at a time per process: two real runs would list the same orphans
// and race each other's unlinks (each counting the other's deletions as its
// own), and a preview taken during a run describes a disk that is changing.
let sweeping = false;

export async function sweepOrphans(opts: { dryRun: boolean; actor: AuditActor | null; requestId?: string; reason?: string }): Promise<SweepResult> {
  if (sweeping) throw new SweepInProgressError();
  sweeping = true;
  try {
    return await runSweep(opts);
  } finally {
    sweeping = false;
  }
}

/** `actor` null = the scheduled run. A real (non-dry) run leaves an audit
 * entry; every file it could not delete becomes a `failed` entry instead of
 * disappearing into the log. */
async function runSweep(opts: { dryRun: boolean; actor: AuditActor | null; requestId?: string; reason?: string }): Promise<SweepResult> {
  const files = await listDiskFiles();
  // A staged file has no attachments row yet but is very much in use. Staged
  // first, attachments second, on purpose: publishing moves a file from one to
  // the other in a single transaction, so reading in this order always finds it
  // in at least one. Attachments first would miss a file published between the
  // two reads — in neither list, and old enough to be collected.
  const staged = await stagedFileIds();
  const dbIds = new Set([
    ...staged,
    ...(await db.select({ id: attachments.id }).from(attachments)).map((r) => r.id),
    ...(await db.select({ id: serverSounds.id }).from(serverSounds)).map((r) => r.id),
  ]);
  const { orphans, recent, missingFiles } = classifyOrphans({ files, dbIds, now: Date.now(), graceMs: config.ORPHAN_GRACE_MS });

  let deleted = 0;
  let failed = 0;
  if (!opts.dryRun) {
    for (const file of orphans) {
      try {
        await fs.unlink(filePathFor(file.name));
        deleted++;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') { deleted++; continue; }
        failed++;
        await recordAuditFailure({ actor: opts.actor, action: 'storage.orphan_delete', targetType: 'system', targetId: file.name, requestId: opts.requestId }, err);
      }
    }
  }

  const result: SweepResult = {
    at: new Date().toISOString(), dryRun: opts.dryRun, scanned: files.length, orphanCount: orphans.length,
    orphanBytes: orphans.reduce((sum, f) => sum + f.size, 0), deleted, failed, recent, missingFiles,
  };
  lastSweep = result;
  if (!opts.dryRun && (deleted > 0 || failed > 0)) {
    await recordAudit({
      actor: opts.actor, action: 'storage.sweep_orphans', targetType: 'system', reason: opts.reason ?? 'varredura agendada',
      detail: { deleted, failed, orphanBytes: result.orphanBytes, missingFiles }, requestId: opts.requestId,
    }).catch((err) => log.error('sweep_orphans', err));
  }
  return result;
}

import { recordAudit } from '../admin/auditLog.js';
import { logger } from '../../lib/logger.js';
import { runRetention, type RetentionSweepResult, type RetentionTarget } from './retentionPolicy.js';
import { retentionTargets } from './retentionTargets.js';

const log = logger.child({ component: 'retention' });

let lastSweep: RetentionSweepResult | null = null;
export const getLastRetentionSweep = (): RetentionSweepResult | null => lastSweep;

/** What the admin "Sistema" page shows: the current policy and the last run. */
export function getRetentionInfo(): { targets: { key: string; days: number }[]; last: RetentionSweepResult | null } {
  return { targets: retentionTargets().map((t) => ({ key: t.key, days: t.days() })), last: lastSweep };
}

/** Thrown when a sweep starts while another one is still running. */
export class RetentionSweepInProgressError extends Error {
  constructor() { super('A retention sweep is already running.'); }
}

// Two runs would only compete for the same oldest rows.
let sweeping = false;

export interface RetentionSweepOptions {
  /** tests only */
  targets?: RetentionTarget[];
  now?: Date;
  batchSize?: number;
  pauseMs?: number;
}

/** Deletes, in small batches, what is older than each table's retention. The run leaves one audit entry
 * when it deleted anything or a table failed. */
export async function sweepRetention(opts: RetentionSweepOptions = {}): Promise<RetentionSweepResult> {
  if (sweeping) throw new RetentionSweepInProgressError();
  sweeping = true;
  try {
    const result = await runRetention(opts.targets ?? retentionTargets(), {
      now: opts.now, batchSize: opts.batchSize, pauseMs: opts.pauseMs,
      onError: (target, err) => log.error('retention sweep failed for a table', err, { table: target.key }),
    });
    lastSweep = result;

    const deleted = Object.fromEntries(result.targets.filter((t) => t.deleted > 0).map((t) => [t.key, t.deleted]));
    const failed = result.targets.filter((t) => t.failed).map((t) => t.key);
    if (Object.keys(deleted).length > 0 || failed.length > 0) {
      log.info('retention sweep done', { deleted, failed, durationMs: result.durationMs });
      // after the deletes, so a run never prunes its own entry
      await recordAudit({
        actor: null, action: 'retention.sweep', targetType: 'system', reason: 'retenção agendada',
        result: failed.length > 0 ? 'failed' : 'ok', detail: { deleted, failed },
      }).catch((err) => log.error('could not record the retention sweep', err));
    }
    return result;
  } finally {
    sweeping = false;
  }
}

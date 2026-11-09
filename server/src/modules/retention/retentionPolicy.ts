// Pure rules of the retention sweep: no database, so the batching and the "0 keeps forever"
// rule are tested without one.

const RETENTION_BATCH_SIZE = 1000;
// a breather between batches so a table with years of backlog is never deleted in one burst
const RETENTION_PAUSE_MS = 100;

export interface RetentionTarget {
  /** stable name: shown in the admin page and stored in the audit entry */
  key: string;
  /** read at sweep time, so a changed setting applies to the next run. 0 keeps the records forever */
  days: () => number;
  /** deletes at most `limit` rows older than `cutoff` and returns how many it deleted */
  deleteBatch: (cutoff: Date, limit: number) => Promise<number>;
}

interface RetentionTargetResult {
  key: string;
  days: number;
  /** null when the target keeps everything */
  cutoff: string | null;
  deleted: number;
  batches: number;
  failed: boolean;
}

export interface RetentionSweepResult {
  at: string;
  durationMs: number;
  targets: RetentionTargetResult[];
}

export const daysAgo = (days: number, now = new Date()): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

export interface RunOptions {
  now?: Date;
  batchSize?: number;
  pauseMs?: number;
  onError?: (target: RetentionTarget, err: unknown) => void;
}

const sleep = (ms: number): Promise<void> => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** One target after another; a failing one is reported and does not stop the rest. */
export async function runRetention(targets: RetentionTarget[], opts: RunOptions = {}): Promise<RetentionSweepResult> {
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? RETENTION_BATCH_SIZE;
  const pauseMs = opts.pauseMs ?? RETENTION_PAUSE_MS;
  const started = Date.now();
  const results: RetentionTargetResult[] = [];

  for (const target of targets) {
    const days = target.days();
    if (days <= 0) {
      results.push({ key: target.key, days: 0, cutoff: null, deleted: 0, batches: 0, failed: false });
      continue;
    }
    const cutoff = daysAgo(days, now);
    const result: RetentionTargetResult = { key: target.key, days, cutoff: cutoff.toISOString(), deleted: 0, batches: 0, failed: false };
    try {
      // the cutoff is fixed for the run, so every batch removes rows from the same shrinking set
      for (;;) {
        const removed = await target.deleteBatch(cutoff, batchSize);
        if (removed > 0) { result.deleted += removed; result.batches++; }
        if (removed < batchSize) break;
        await sleep(pauseMs);
      }
    } catch (err) {
      result.failed = true;
      opts.onError?.(target, err);
    }
    results.push(result);
  }
  return { at: new Date().toISOString(), durationMs: Date.now() - started, targets: results };
}

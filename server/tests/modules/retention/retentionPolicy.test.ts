import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseRetentionDays } from '../../../src/config/env.js';
import { daysAgo, runRetention, type RetentionTarget } from '../../../src/modules/retention/retentionPolicy.js';

describe('daysAgo', () => {
  it('goes back the exact number of days', () => {
    assert.equal(daysAgo(30, new Date('2026-09-30T12:00:00Z')).toISOString(), '2026-08-31T12:00:00.000Z');
  });
});

describe('parseRetentionDays', () => {
  it('uses the default when unset or blank', () => {
    assert.equal(parseRetentionDays('X', undefined, 30), 30);
    assert.equal(parseRetentionDays('X', '  ', 30), 30);
  });

  it('accepts 0 as "keep forever", even over a non-zero default', () => {
    assert.equal(parseRetentionDays('X', '0', 30), 0);
  });

  it('reads a whole number of days', () => {
    assert.equal(parseRetentionDays('X', ' 365 ', 0), 365);
  });

  it('refuses a value that is not a whole, non-negative number, naming the variable', () => {
    for (const bad of ['-1', '1.5', 'abc', '10d', 'Infinity']) {
      assert.throws(() => parseRetentionDays('AUDIT_RETENTION_DAYS', bad, 0), /AUDIT_RETENTION_DAYS/, bad);
    }
  });
});

/** A fake table of `total` old rows: every batch removes up to `limit` and the call is recorded. */
function fakeTable(key: string, days: number, total: number) {
  const calls: { cutoff: Date; limit: number }[] = [];
  let left = total;
  const target: RetentionTarget = {
    key, days: () => days,
    async deleteBatch(cutoff, limit) {
      calls.push({ cutoff, limit });
      const removed = Math.min(left, limit);
      left -= removed;
      return removed;
    },
  };
  return { target, calls, remaining: () => left };
}

const NOW = new Date('2026-06-15T00:00:00Z');

describe('runRetention', () => {
  it('deletes in batches until a batch comes back short, and reports totals', async () => {
    const t = fakeTable('a', 10, 2500);
    const result = await runRetention([t.target], { now: NOW, batchSize: 1000, pauseMs: 0 });
    assert.deepEqual(t.calls.map((c) => c.limit), [1000, 1000, 1000]);
    assert.equal(t.remaining(), 0);
    assert.deepEqual(result.targets, [{ key: 'a', days: 10, cutoff: '2026-06-05T00:00:00.000Z', deleted: 2500, batches: 3, failed: false }]);
  });

  it('asks once more when the last batch is exactly full, so a full table is never left half done', async () => {
    const t = fakeTable('a', 1, 2000);
    const result = await runRetention([t.target], { now: NOW, batchSize: 1000, pauseMs: 0 });
    assert.equal(t.calls.length, 3);
    assert.equal(result.targets[0]!.deleted, 2000);
  });

  it('keeps one cutoff for the whole run', async () => {
    const t = fakeTable('a', 1, 3000);
    await runRetention([t.target], { now: NOW, batchSize: 1000, pauseMs: 0 });
    assert.equal(new Set(t.calls.map((c) => c.cutoff.getTime())).size, 1);
  });

  it('0 days keeps everything: the table is not even asked', async () => {
    const t = fakeTable('a', 0, 500);
    const result = await runRetention([t.target], { now: NOW, pauseMs: 0 });
    assert.equal(t.calls.length, 0);
    assert.equal(t.remaining(), 500);
    assert.deepEqual(result.targets, [{ key: 'a', days: 0, cutoff: null, deleted: 0, batches: 0, failed: false }]);
  });

  it('a table with nothing old costs one query and reports no batch', async () => {
    const t = fakeTable('a', 5, 0);
    const result = await runRetention([t.target], { now: NOW, pauseMs: 0 });
    assert.equal(t.calls.length, 1);
    assert.equal(result.targets[0]!.batches, 0);
  });

  it('a failing table is reported and does not stop the others', async () => {
    const broken: RetentionTarget = { key: 'broken', days: () => 5, deleteBatch: async () => { throw new Error('boom'); } };
    const ok = fakeTable('ok', 5, 3);
    const seen: string[] = [];
    const result = await runRetention([broken, ok.target], { now: NOW, pauseMs: 0, onError: (target) => seen.push(target.key) });
    assert.deepEqual(result.targets.map((r) => [r.key, r.failed, r.deleted]), [['broken', true, 0], ['ok', false, 3]]);
    assert.deepEqual(seen, ['broken']);
  });

  it('keeps what a table deleted before it failed', async () => {
    let calls = 0;
    const flaky: RetentionTarget = { key: 'flaky', days: () => 5, deleteBatch: async (_c, limit) => { if (++calls === 2) throw new Error('lost connection'); return limit; } };
    const result = await runRetention([flaky], { now: NOW, batchSize: 10, pauseMs: 0, onError: () => {} });
    assert.deepEqual([result.targets[0]!.deleted, result.targets[0]!.failed], [10, true]);
  });

  it('reads the days when it runs, so a changed setting applies to the next sweep', async () => {
    let days = 0;
    const calls: Date[] = [];
    const target: RetentionTarget = { key: 'a', days: () => days, deleteBatch: async (cutoff) => { calls.push(cutoff); return 0; } };
    await runRetention([target], { now: NOW, pauseMs: 0 });
    days = 2;
    await runRetention([target], { now: NOW, pauseMs: 0 });
    assert.deepEqual(calls.map((c) => c.toISOString()), ['2026-06-13T00:00:00.000Z']);
  });
});

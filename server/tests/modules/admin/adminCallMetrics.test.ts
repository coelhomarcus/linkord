import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adminMetricsDays } from '../../../src/modules/admin/adminCallMetrics.js';

test('call metrics include today and six previous calendar days in Belém', () => {
  const beforeMidnight = adminMetricsDays(new Date('2026-12-01T02:59:59Z'));
  const afterMidnight = adminMetricsDays(new Date('2026-12-01T03:00:00Z'));
  assert.deepEqual(beforeMidnight, [
    '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30',
  ]);
  assert.deepEqual(afterMidnight, [...beforeMidnight.slice(1), '2026-12-01']);
});

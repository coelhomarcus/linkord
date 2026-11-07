import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { recordDmCallLine, type DmCallLineInsert } from '../../../src/modules/calls/dmCallLog.js';

describe('recordDmCallLine', () => {
  it('skips a failed call', async () => {
    const rows: DmCallLineInsert[] = [];
    await recordDmCallLine(
      { conversationId: 'dm', callerId: 'a', reason: 'failed', durationSeconds: 4 },
      async (values) => { rows.push(values); },
    );
    assert.deepEqual(rows, []);
  });

  it('stores no duration when the call was missed', async () => {
    const rows: DmCallLineInsert[] = [];
    await recordDmCallLine(
      { conversationId: 'dm', callerId: 'a', reason: 'missed', durationSeconds: null },
      async (values) => { rows.push(values); },
    );
    assert.equal(rows[0]?.callDurationSeconds, null);
    assert.equal(rows[0]?.kind, 'dm_call');
    assert.equal(rows[0]?.authorId, 'a');
  });

  it('stores the talk time when the call was answered', async () => {
    const rows: DmCallLineInsert[] = [];
    await recordDmCallLine(
      { conversationId: 'dm', callerId: 'a', reason: 'ended', durationSeconds: 90 },
      async (values) => { rows.push(values); },
    );
    assert.equal(rows[0]?.callDurationSeconds, 90);
  });
});

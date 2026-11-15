import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isLoadFailure, retryDelayMs } from '../../src/main/loadRetry.js';

describe('retryDelayMs', () => {
  it('doubles from one second up to thirty', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5, 10].map(retryDelayMs), [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });
});

describe('isLoadFailure', () => {
  it('counts main-frame failures but not a replaced navigation or a subframe', () => {
    assert.equal(isLoadFailure(-102, true), true);
    assert.equal(isLoadFailure(-3, true), false);
    assert.equal(isLoadFailure(-102, false), false);
  });
});

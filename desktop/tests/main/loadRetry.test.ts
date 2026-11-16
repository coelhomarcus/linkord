import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HEALTHY_AFTER_MS, MAX_CRASHES, NO_CRASHES, isLoadFailure, pageCrashed, pageLoaded, retryDelayMs, type CrashHistory } from '../../src/main/loadRetry.js';

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

describe('pageCrashed', () => {
  // a page that loads and dies one second later, again and again
  function crashLoop(times: number) {
    let history: CrashHistory = NO_CRASHES;
    let now = 0;
    const decisions = [];
    for (let i = 0; i < times; i++) {
      history = pageLoaded(history, now);
      now += 1_000;
      const result = pageCrashed(history, now);
      history = result.history;
      decisions.push(result.decision);
    }
    return { history, decisions };
  }

  it('reloads after a growing delay, then gives up instead of looping', () => {
    const { decisions } = crashLoop(MAX_CRASHES + 1);
    assert.deepEqual(decisions, [
      ...Array.from({ length: MAX_CRASHES }, (_, i) => ({ kind: 'reload', delayMs: retryDelayMs(i) })),
      { kind: 'give-up' },
    ]);
  });

  it('counts a crash before the page ever loaded', () => {
    const first = pageCrashed(NO_CRASHES, 0);
    const second = pageCrashed(first.history, 500);
    assert.deepEqual(second.decision, { kind: 'reload', delayMs: retryDelayMs(1) });
  });

  it('forgets earlier crashes once the page stayed up long enough', () => {
    const { history } = crashLoop(MAX_CRASHES);
    const loaded = pageLoaded(history, 100_000);
    const result = pageCrashed(loaded, 100_000 + HEALTHY_AFTER_MS);
    assert.deepEqual(result.decision, { kind: 'reload', delayMs: retryDelayMs(0) });
    assert.equal(result.history.count, 1);
  });

  it('gives a reload from the stopped screen the same chances again', () => {
    const { history } = crashLoop(MAX_CRASHES + 1);
    assert.deepEqual(history, NO_CRASHES);
  });
});

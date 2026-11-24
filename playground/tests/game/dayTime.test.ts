import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { advanceClock, celestialAngle, DAY_TICKS, daylight, moonPhase, NEW_WORLD_TIME, readClock, skyDarken, timeOfDay } from '../../src/game/dayTime.js';

describe('day time', () => {
  test('the sun is overhead at noon, under the world at midnight, rising at tick 0', () => {
    assert.ok(Math.abs(celestialAngle(6000)) < 1e-9 || Math.abs(celestialAngle(6000) - 1) < 1e-9);
    assert.ok(Math.abs(celestialAngle(18_000) - 0.5) < 1e-9);
    assert.ok(celestialAngle(0) > 0.75 && celestialAngle(0) < 0.8);
  });

  test('the sky light is whole by day, loses 11 steps at night and dims through the twilight', () => {
    assert.equal(daylight(6000), 1);
    assert.equal(skyDarken(6000), 0);
    assert.equal(skyDarken(18_000), 11);
    const dusk = skyDarken(12_800);
    assert.ok(dusk > 0 && dusk < 11, `dusk darkens part of the way, got ${dusk}`);
  });

  test('the moon changes phase every day and comes back after eight', () => {
    assert.equal(moonPhase(0), 0);
    assert.equal(moonPhase(DAY_TICKS + 5), 1);
    assert.equal(moonPhase(DAY_TICKS * 8), 0);
  });

  test('the clock wraps on whole moon cycles, and a bad stored one starts in the morning', () => {
    const wrapped = advanceClock(DAY_TICKS * 8000 - 10, 30);
    assert.equal(wrapped, 20);
    assert.equal(timeOfDay(wrapped), 20);
    assert.equal(readClock(-5), NEW_WORLD_TIME);
    assert.equal(readClock('noon'), NEW_WORLD_TIME);
    assert.equal(readClock(12_345), 12_345);
  });
});

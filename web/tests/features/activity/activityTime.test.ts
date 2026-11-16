import { describe, expect, it } from 'vitest';
import { formatActivityTimer, playedAgo } from '@/features/activity/activityTime';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatActivityTimer', () => {
  it('reads as a stopwatch: minutes and seconds, then hours', () => {
    expect(formatActivityTimer(0)).toBe('0:00');
    expect(formatActivityTimer(42_000)).toBe('0:42');
    expect(formatActivityTimer(41 * MIN + 28_000)).toBe('41:28');
    expect(formatActivityTimer(HOUR + 19 * MIN + 35_000)).toBe('1:19:35');
    expect(formatActivityTimer(26 * HOUR + 5 * MIN)).toBe('26:05:00');
  });

  it('never runs backwards from a start a little in the future', () => {
    expect(formatActivityTimer(-5_000)).toBe('0:00');
  });
});

describe('playedAgo', () => {
  it('picks the largest whole unit', () => {
    expect(playedAgo(30_000)).toEqual({ unit: 'now', count: 0 });
    expect(playedAgo(25 * MIN)).toEqual({ unit: 'minutes', count: 25 });
    expect(playedAgo(HOUR + 59 * MIN)).toEqual({ unit: 'hours', count: 1 });
    expect(playedAgo(2 * DAY + HOUR)).toEqual({ unit: 'days', count: 2 });
    expect(playedAgo(15 * DAY)).toEqual({ unit: 'weeks', count: 2 });
    expect(playedAgo(65 * DAY)).toEqual({ unit: 'months', count: 2 });
    expect(playedAgo(800 * DAY)).toEqual({ unit: 'years', count: 2 });
  });
});

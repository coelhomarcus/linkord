import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { keepActivityStart, sanitizeActivityReport, sanitizeActivitySettings, shownActivity, DEFAULT_ACTIVITY_SETTINGS } from '../../../src/modules/presence/activity.js';

const now = Date.parse('2026-11-15T12:00:00Z');

describe('sanitizeActivityReport', () => {
  test('keeps a well-formed report and builds the icon path itself', () => {
    const local = 'a'.repeat(64);
    assert.deepEqual(sanitizeActivityReport({ key: 'spotify', kind: 'using', name: '  Spotify ', icon: { local }, startedAt: now - 1000 }, now), {
      key: 'spotify', kind: 'using', name: 'Spotify', icon: `/api/activity/icons/${local}.webp`, startedAt: new Date(now - 1000).toISOString(),
    });
  });

  test('refuses unknown kinds, bad keys and empty names', () => {
    for (const raw of [{ key: 'x', kind: 'watching', name: 'x' }, { key: '../x', kind: 'playing', name: 'x' }, { key: 'x', kind: 'playing', name: '  ' }, 'x', null]) {
      assert.equal(sanitizeActivityReport(raw, now), null);
    }
  });

  test('cuts the name and replaces a start in the future or long past with now', () => {
    const long = sanitizeActivityReport({ key: 'x', kind: 'playing', name: 'a'.repeat(200), startedAt: now + 3_600_000 }, now);
    assert.equal(long?.name.length, 64);
    assert.equal(long?.startedAt, new Date(now).toISOString());
    assert.equal(sanitizeActivityReport({ key: 'x', kind: 'playing', name: 'x', startedAt: now - 30 * 86_400_000 }, now)?.startedAt, new Date(now).toISOString());
  });

  test('places a report with its send time on this server\'s clock, however far off the reporter\'s is', () => {
    const HOUR = 3_600_000;
    // a computer three hours behind: started 10 minutes ago by its own clock
    const behind = sanitizeActivityReport({ key: 'x', kind: 'playing', name: 'x', startedAt: now - 3 * HOUR - 600_000, sentAt: now - 3 * HOUR }, now);
    assert.equal(behind?.startedAt, new Date(now - 600_000).toISOString());
    // three hours ahead: a start that would be in the future here is still 42 seconds ago
    const ahead = sanitizeActivityReport({ key: 'x', kind: 'playing', name: 'x', startedAt: now + 3 * HOUR - 42_000, sentAt: now + 3 * HOUR }, now);
    assert.equal(ahead?.startedAt, new Date(now - 42_000).toISOString());
    // a start after the send is nonsense, and a week-long one a clock gone wrong
    assert.equal(sanitizeActivityReport({ key: 'x', kind: 'playing', name: 'x', startedAt: now + 5000, sentAt: now }, now)?.startedAt, new Date(now).toISOString());
    assert.equal(sanitizeActivityReport({ key: 'x', kind: 'playing', name: 'x', startedAt: 0, sentAt: 30 * 86_400_000 }, now)?.startedAt, new Date(now).toISOString());
  });
});

describe('keepActivityStart', () => {
  const at = (ms: number) => ({ key: 'minecraft', kind: 'playing' as const, name: 'Minecraft', icon: null, startedAt: new Date(ms).toISOString() });
  test('keeps the start already shown when the same activity is reported again a moment later', () => {
    assert.equal(keepActivityStart(at(now), at(now + 800))?.startedAt, at(now).startedAt);
    assert.equal(keepActivityStart(at(now), at(now + 60_000))?.startedAt, at(now + 60_000).startedAt);
    assert.equal(keepActivityStart(at(now), { ...at(now + 800), key: 'spotify' })?.startedAt, at(now + 800).startedAt);
    assert.equal(keepActivityStart(null, at(now))?.startedAt, at(now).startedAt);
    assert.equal(keepActivityStart(at(now), null), null);
  });
});

describe('sanitizeActivitySettings', () => {
  test('changes only what the body names, and keeps only valid keys, once each', () => {
    assert.deepEqual(sanitizeActivitySettings({ sharing: false }, { sharing: true, hidden: ['a'] }), { sharing: false, hidden: ['a'] });
    assert.deepEqual(sanitizeActivitySettings({ hidden: ['b', 'b', 'Bad!', 3] }, DEFAULT_ACTIVITY_SETTINGS), { sharing: true, hidden: ['b'] });
    assert.equal(sanitizeActivitySettings({}, DEFAULT_ACTIVITY_SETTINGS), null);
  });
});

describe('shownActivity', () => {
  const activity = { key: 'minecraft', kind: 'playing' as const, name: 'Minecraft', icon: null, startedAt: new Date(now).toISOString() };
  test('shows it by default, never when sharing is off or the key is hidden', () => {
    assert.equal(shownActivity(activity, DEFAULT_ACTIVITY_SETTINGS), activity);
    assert.equal(shownActivity(activity, { sharing: false, hidden: [] }), null);
    assert.equal(shownActivity(activity, { sharing: true, hidden: ['minecraft'] }), null);
  });
});

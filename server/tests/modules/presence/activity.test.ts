import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeActivityReport, sanitizeActivitySettings, shownActivity, DEFAULT_ACTIVITY_SETTINGS } from '../../../src/modules/presence/activity.js';

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

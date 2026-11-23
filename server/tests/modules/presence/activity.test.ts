import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { keepActivityStart, sameActivity, sanitizeActivityReport, sanitizeActivitySettings, shownActivity, DEFAULT_ACTIVITY_SETTINGS, type Activity } from '../../../src/modules/presence/activity.js';

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

describe('sanitizeActivityReport with rich presence', () => {
  const local = 'b'.repeat(64);
  const base = { key: 'discord:123456789012345678', kind: 'playing', name: 'Some Game', startedAt: now - 60_000, sentAt: now };
  const rich = (value: unknown) => sanitizeActivityReport({ ...base, rich: value }, now)?.rich;

  test('keeps every valid field and builds the image paths itself', () => {
    assert.deepEqual(rich({
      details: ' Competitive ', state: 'Dust II', largeImage: { local, text: 'Map' }, smallImage: { local },
      party: { size: 2, max: 5 }, timestamps: { start: now - 30_000, end: now + 600_000 },
      buttons: [{ label: 'Join', url: 'https://example.com/join?x=1' }],
    }), {
      details: 'Competitive', state: 'Dust II',
      largeImage: { url: `/api/activity/icons/${local}.webp`, text: 'Map' }, smallImage: { url: `/api/activity/icons/${local}.webp` },
      party: { size: 2, max: 5 }, timestamps: { start: now - 30_000, end: now + 600_000 },
      buttons: [{ label: 'Join', url: 'https://example.com/join?x=1' }],
    });
  });

  test('flattens control characters and cuts long text', () => {
    const result = rich({ details: 'a\nb\u202Ec\u0000', state: 's'.repeat(300), largeImage: { local, text: 't'.repeat(300) } });
    assert.equal(result?.details, 'a b c');
    assert.equal(result?.state?.length, 128);
    assert.equal(result?.largeImage?.text?.length, 128);
  });

  test('drops images that are not stored icons, and buttons that are not https links', () => {
    const result = rich({
      details: 'x',
      largeImage: { url: 'https://evil.example/a.png' }, smallImage: { local: '../etc/passwd' },
      buttons: [
        { label: 'js', url: 'javascript:alert(1)' }, { label: 'http', url: 'http://example.com' },
        { label: 'creds', url: 'https://user:pw@example.com' }, { label: '', url: 'https://example.com' },
      ],
    });
    assert.deepEqual(result, { details: 'x' });
    const long = `https://example.com/${'a'.repeat(600)}`;
    assert.equal(rich({ buttons: [{ label: 'x', url: long }] }), undefined);
  });

  test('keeps at most two buttons and cuts their labels to 32 characters', () => {
    const buttons = rich({ buttons: [1, 2, 3].map((i) => ({ label: `${i}${'l'.repeat(50)}`, url: `https://example.com/${i}` })) })?.buttons;
    assert.equal(buttons?.length, 2);
    assert.equal(buttons?.[0]?.label.length, 32);
  });

  test('keeps a party only with whole numbers within bounds', () => {
    for (const party of [{ size: 0, max: 5 }, { size: 6, max: 5 }, { size: 1.5, max: 5 }, { size: 1, max: 1_000_001 }, { size: '2', max: 5 }, null]) {
      assert.equal(rich({ party }), undefined);
    }
    assert.deepEqual(rich({ party: { size: 1_000_000, max: 1_000_000 } }), { party: { size: 1_000_000, max: 1_000_000 } });
  });

  test('places the game\'s timestamps on this server\'s clock with sentAt, and drops absurd ones', () => {
    const HOUR = 3_600_000;
    // a computer three hours behind: the match started 5 minutes ago and ends in 10, by its own clock
    const behind = sanitizeActivityReport({ ...base, sentAt: now - 3 * HOUR, rich: { timestamps: { start: now - 3 * HOUR - 300_000, end: now - 3 * HOUR + 600_000 } } }, now);
    assert.deepEqual(behind?.rich?.timestamps, { start: now - 300_000, end: now + 600_000 });
    // seconds read as milliseconds land in 1970; an end already past or a week away is nonsense
    assert.equal(rich({ timestamps: { start: Math.floor(now / 1000) - 60 } }), undefined);
    assert.equal(rich({ timestamps: { end: now - 1000 } }), undefined);
    assert.equal(rich({ timestamps: { end: now + 8 * 24 * HOUR } }), undefined);
    assert.equal(rich({ timestamps: { start: now + 60_000 } }), undefined);
    assert.deepEqual(rich({ timestamps: { start: 'now', end: now + 1000 } }), { timestamps: { end: now + 1000 } });
  });

  test('drops rich when nothing valid is left, and ignores what is not an object', () => {
    for (const value of [{}, { details: '  ' }, 'rich', 42, null, []]) {
      const activity = sanitizeActivityReport({ ...base, rich: value }, now);
      assert.ok(activity);
      assert.equal('rich' in activity, false);
    }
  });
});

describe('sameActivity', () => {
  const activity: Activity = {
    key: 'discord:123456789012345678', kind: 'playing', name: 'Game', icon: null, startedAt: new Date(now).toISOString(),
    rich: { details: 'a', party: { size: 1, max: 4 }, buttons: [{ label: 'x', url: 'https://example.com/' }] },
  };
  test('compares rich deeply', () => {
    assert.equal(sameActivity(activity, structuredClone(activity)), true);
    assert.equal(sameActivity(activity, { ...activity, rich: { ...activity.rich, party: { size: 2, max: 4 } } }), false);
    assert.equal(sameActivity(activity, { ...activity, rich: { ...activity.rich, buttons: [] } }), false);
    assert.equal(sameActivity(activity, { ...activity, rich: undefined }), false);
    const { rich: _rich, ...plain } = activity;
    assert.equal(sameActivity(plain, { ...plain, rich: undefined }), true);
    assert.equal(sameActivity(null, undefined), true);
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

  test('keeps the game\'s own timestamps when a report placed them a moment apart, and passes rich through', () => {
    const withRich = (ms: number, start: number, end?: number): Activity => ({ ...at(ms), rich: { state: 'x', timestamps: { start, ...(end !== undefined ? { end } : {}) } } });
    const kept = keepActivityStart(withRich(now, now - 1000, now + 60_000), withRich(now + 200, now - 800, now + 60_300));
    assert.deepEqual(kept?.rich, { state: 'x', timestamps: { start: now - 1000, end: now + 60_000 } });
    assert.equal(sameActivity(kept, withRich(now, now - 1000, now + 60_000)), true);
    // a new round is a new start
    assert.deepEqual(keepActivityStart(withRich(now, now - 1000), withRich(now, now + 300_000))?.rich?.timestamps, { start: now + 300_000 });
    assert.deepEqual(keepActivityStart(at(now), withRich(now, now - 10))?.rich, { state: 'x', timestamps: { start: now - 10 } });
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

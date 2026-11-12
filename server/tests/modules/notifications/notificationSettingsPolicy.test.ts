import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyNotificationChange, isDefaultSetting, isMuteDuration, isMutedNow, isNotificationLevel, policyAlerts, resolveNotificationPolicy,
  type NotificationSetting,
} from '../../../src/modules/notifications/notificationSettingsPolicy.js';

const now = new Date('2026-11-12T12:00:00Z');
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const setting = (partial: Partial<NotificationSetting>): NotificationSetting => ({ level: null, muted: false, mutedUntil: null, ...partial });

describe('resolveNotificationPolicy', () => {
  it('defaults to every message, unmuted, with nothing set', () => {
    assert.deepEqual(resolveNotificationPolicy({}, now), { level: 'all', muted: false });
    assert.deepEqual(resolveNotificationPolicy({ conversation: null, server: null }, now), { level: 'all', muted: false });
  });

  it('a channel inherits its server level', () => {
    assert.equal(resolveNotificationPolicy({ server: setting({ level: 'mentions' }) }, now).level, 'mentions');
    assert.equal(resolveNotificationPolicy({ conversation: setting({}), server: setting({ level: 'nothing' }) }, now).level, 'nothing');
  });

  it("a channel's own level wins over its server's, both ways", () => {
    assert.equal(resolveNotificationPolicy({ conversation: setting({ level: 'all' }), server: setting({ level: 'nothing' }) }, now).level, 'all');
    assert.equal(resolveNotificationPolicy({ conversation: setting({ level: 'nothing' }), server: setting({ level: 'all' }) }, now).level, 'nothing');
  });

  it('a muted server mutes every channel in it, whatever level the channel picked', () => {
    const policy = resolveNotificationPolicy({ conversation: setting({ level: 'all' }), server: setting({ muted: true }) }, now);
    assert.deepEqual(policy, { level: 'all', muted: true });
  });

  it('a channel or DM can be muted on its own', () => {
    assert.equal(resolveNotificationPolicy({ conversation: setting({ muted: true, mutedUntil: later(15) }) }, now).muted, true);
  });

  it('a mute ends at its time', () => {
    const until = later(60);
    const muted = setting({ muted: true, mutedUntil: until });
    assert.equal(resolveNotificationPolicy({ conversation: muted }, new Date(until.getTime() - 1)).muted, true);
    assert.equal(resolveNotificationPolicy({ conversation: muted }, until).muted, false);
    assert.equal(resolveNotificationPolicy({ server: muted }, later(61)).muted, false);
  });
});

describe('isMutedNow', () => {
  it('a mute without an end lasts until it is turned off', () => {
    assert.equal(isMutedNow(setting({ muted: true }), later(60 * 24 * 365)), true);
  });

  it('an end time without the muted flag is no mute', () => {
    assert.equal(isMutedNow(setting({ mutedUntil: later(15) }), now), false);
    assert.equal(isMutedNow(null, now), false);
  });
});

describe('policyAlerts', () => {
  it('"all" alerts for every message, "mentions" only for a mention, "nothing" never', () => {
    assert.equal(policyAlerts({ level: 'all', muted: false }, false), true);
    assert.equal(policyAlerts({ level: 'mentions', muted: false }, false), false);
    assert.equal(policyAlerts({ level: 'mentions', muted: false }, true), true);
    assert.equal(policyAlerts({ level: 'nothing', muted: false }, true), false);
  });

  it('a mute silences mentions too', () => {
    assert.equal(policyAlerts({ level: 'all', muted: true }, true), false);
  });
});

describe('applyNotificationChange', () => {
  it('mutes for one of the offered durations, counted from now', () => {
    assert.deepEqual(applyNotificationChange(null, { mute: 15 }, now), { level: null, muted: true, mutedUntil: later(15) });
    assert.deepEqual(applyNotificationChange(null, { mute: 1440 }, now), { level: null, muted: true, mutedUntil: later(1440) });
    assert.deepEqual(applyNotificationChange(null, { mute: 'forever' }, now), { level: null, muted: true, mutedUntil: null });
  });

  it('changing the level keeps a running mute, and unmuting keeps the level', () => {
    const muted = applyNotificationChange(null, { mute: 60 }, now);
    assert.deepEqual(applyNotificationChange(muted, { level: 'mentions' }, now), { level: 'mentions', muted: true, mutedUntil: later(60) });
    assert.deepEqual(applyNotificationChange({ ...muted, level: 'mentions' }, { mute: false }, now), { level: 'mentions', muted: false, mutedUntil: null });
  });

  it('an expired mute is dropped by the next change', () => {
    const expired = setting({ level: 'nothing', muted: true, mutedUntil: later(-1) });
    assert.deepEqual(applyNotificationChange(expired, { level: 'all' }, now), { level: 'all', muted: false, mutedUntil: null });
  });

  it('null goes back to inheriting', () => {
    assert.equal(applyNotificationChange(setting({ level: 'nothing' }), { level: null }, now).level, null);
  });
});

describe('isDefaultSetting', () => {
  it('no level and no running mute says nothing (the row is deleted)', () => {
    assert.equal(isDefaultSetting(setting({}), now), true);
    assert.equal(isDefaultSetting(setting({ muted: true, mutedUntil: later(-5) }), now), true);
    assert.equal(isDefaultSetting(setting({ level: 'all' }), now), false);
    assert.equal(isDefaultSetting(setting({ muted: true }), now), false);
  });
});

describe('input checks', () => {
  it('accepts only the offered levels and durations', () => {
    assert.equal(isNotificationLevel('mentions'), true);
    assert.equal(isNotificationLevel('loud'), false);
    assert.equal(isMuteDuration(480), true);
    assert.equal(isMuteDuration('forever'), true);
    assert.equal(isMuteDuration(30), false);
    assert.equal(isMuteDuration('15'), false);
  });
});

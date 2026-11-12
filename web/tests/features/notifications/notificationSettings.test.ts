import { describe, expect, it } from 'vitest';
import {
  DEFAULT_POLICY, badgeCounts, isMutedNow, nextMuteExpiry, policyAlerts, resolveNotificationPolicy, visibleUnread,
  type NotificationSetting,
} from '@/features/notifications/notificationSettings';

// The same cases as server/tests/modules/notifications/notificationSettingsPolicy.test.ts: the server
// decides pushes with that copy of the rule, this one sounds and badges.

const now = Date.parse('2026-11-12T12:00:00Z');
const later = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
const setting = (partial: Partial<NotificationSetting>): NotificationSetting => ({ level: null, muted: false, mutedUntil: null, ...partial });

describe('resolveNotificationPolicy', () => {
  it('defaults to every message, unmuted, with nothing set', () => {
    expect(resolveNotificationPolicy({}, now)).toEqual({ level: 'all', muted: false });
  });

  it('a channel inherits its server level', () => {
    expect(resolveNotificationPolicy({ server: setting({ level: 'mentions' }) }, now).level).toBe('mentions');
    expect(resolveNotificationPolicy({ conversation: setting({}), server: setting({ level: 'nothing' }) }, now).level).toBe('nothing');
  });

  it("a channel's own level wins over its server's, both ways", () => {
    expect(resolveNotificationPolicy({ conversation: setting({ level: 'all' }), server: setting({ level: 'nothing' }) }, now).level).toBe('all');
    expect(resolveNotificationPolicy({ conversation: setting({ level: 'nothing' }), server: setting({ level: 'all' }) }, now).level).toBe('nothing');
  });

  it('a muted server mutes every channel in it, whatever level the channel picked', () => {
    expect(resolveNotificationPolicy({ conversation: setting({ level: 'all' }), server: setting({ muted: true }) }, now)).toEqual({ level: 'all', muted: true });
  });

  it('a mute ends at its time', () => {
    const muted = setting({ muted: true, mutedUntil: later(60) });
    expect(resolveNotificationPolicy({ conversation: muted }, now + 60 * 60_000 - 1).muted).toBe(true);
    expect(resolveNotificationPolicy({ conversation: muted }, now + 60 * 60_000).muted).toBe(false);
  });

  it('a mute without an end lasts until it is turned off; an end without the flag is no mute', () => {
    expect(isMutedNow(setting({ muted: true }), now + 365 * 24 * 3600_000)).toBe(true);
    expect(isMutedNow(setting({ mutedUntil: later(15) }), now)).toBe(false);
  });
});

describe('policyAlerts', () => {
  it('"all" alerts for every message, "mentions" only for a mention, "nothing" never, a mute never', () => {
    expect(policyAlerts({ level: 'all', muted: false }, false)).toBe(true);
    expect(policyAlerts({ level: 'mentions', muted: false }, false)).toBe(false);
    expect(policyAlerts({ level: 'mentions', muted: false }, true)).toBe(true);
    expect(policyAlerts({ level: 'nothing', muted: false }, true)).toBe(false);
    expect(policyAlerts({ level: 'all', muted: true }, true)).toBe(false);
  });
});

describe('badges', () => {
  it('a muted conversation shows only its mentions; the level alone hides nothing', () => {
    expect(visibleUnread({ level: 'all', muted: true }, 7, 0)).toBe(0);
    expect(visibleUnread({ level: 'all', muted: true }, 7, 2)).toBe(2);
    expect(visibleUnread({ level: 'nothing', muted: false }, 7, 0)).toBe(7);
  });

  it('badgeCounts resolves each conversation with its server', () => {
    const policies: Record<string, NotificationSetting> = { s1: setting({ muted: true }) };
    const policyFor = (target: { id: string; serverId?: string | null }) =>
      target.serverId && policies[target.serverId] ? resolveNotificationPolicy({ server: policies[target.serverId] }, now) : DEFAULT_POLICY;
    const counts = badgeCounts(
      [{ id: 'dm' }, { id: 'quiet', serverId: 's1' }, { id: 'pinged', serverId: 's1' }, { id: 'loud', serverId: 's2' }],
      new Map([['dm', 3], ['quiet', 5], ['pinged', 4], ['loud', 1]]),
      new Map([['pinged', 1]]),
      policyFor,
    );
    expect([...counts]).toEqual([['dm', 3], ['pinged', 1], ['loud', 1]]);
  });
});

describe('nextMuteExpiry', () => {
  it('is the soonest running mute with an end', () => {
    const settings = {
      servers: { a: setting({ muted: true, mutedUntil: later(60) }), b: setting({ muted: true }) },
      conversations: { c: setting({ muted: true, mutedUntil: later(15) }), d: setting({ muted: true, mutedUntil: later(-5) }) },
    };
    expect(nextMuteExpiry(settings, now)).toBe(Date.parse(later(15)));
    expect(nextMuteExpiry({ servers: {}, conversations: {} }, now)).toBeNull();
  });
});

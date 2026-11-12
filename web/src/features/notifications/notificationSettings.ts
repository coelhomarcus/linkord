// Mirrors server/src/modules/notifications/notificationSettingsPolicy.ts: the server applies it to pushes and
// the app icon badge, this copy to sounds and unread badges. The tests of both pin the same cases.
import type { NotificationSetting, NotificationSettings } from '@/shared/types/protocol';

export const NOTIFICATION_LEVELS = ['all', 'mentions', 'nothing'] as const;
export type NotificationLevel = typeof NOTIFICATION_LEVELS[number];

/** What a mute may last, in minutes, as the server accepts it; 'forever' lasts until turned off. */
export const MUTE_DURATIONS_MINUTES = [15, 60, 480, 1440] as const;
export type MuteDuration = typeof MUTE_DURATIONS_MINUTES[number] | 'forever';

export type { NotificationSetting, NotificationSettings };

export const EMPTY_NOTIFICATION_SETTINGS: NotificationSettings = { servers: {}, conversations: {} };

export interface NotificationPolicy { level: NotificationLevel; muted: boolean }

export const DEFAULT_POLICY: NotificationPolicy = { level: 'all', muted: false };

export interface NotificationSettingChange {
  level?: NotificationLevel | null;
  mute?: MuteDuration | false;
}

export function isMutedNow(setting: NotificationSetting | null | undefined, now: number): boolean {
  return !!setting?.muted && (setting.mutedUntil === null || Date.parse(setting.mutedUntil) > now);
}

/** A channel's level wins over its server's, which wins over "all". Muting a server silences every channel
 * in it; a channel or DM can also be muted on its own. A DM has no server. */
export function resolveNotificationPolicy(
  input: { conversation?: NotificationSetting | null; server?: NotificationSetting | null },
  now: number,
): NotificationPolicy {
  return {
    level: input.conversation?.level ?? input.server?.level ?? 'all',
    muted: isMutedNow(input.conversation, now) || isMutedNow(input.server, now),
  };
}

/** Whether a message plays a sound (and gets a push, on the server). */
export function policyAlerts(policy: NotificationPolicy, mentioned: boolean): boolean {
  if (policy.muted) return false;
  return policy.level === 'all' || (policy.level === 'mentions' && mentioned);
}

/** The count a row, a server icon or a tab shows: a muted conversation shows only its unread mentions. */
export function visibleUnread(policy: NotificationPolicy, unread: number, mentions: number): number {
  return policy.muted ? mentions : unread;
}

/** visibleUnread for every conversation that has something to show; the rest are left out. */
export function badgeCounts(
  conversations: readonly { id: string; serverId?: string | null }[],
  unreadByConversation: ReadonlyMap<string, number>,
  mentionsByConversation: ReadonlyMap<string, number>,
  policyFor: (target: { id: string; serverId?: string | null }) => NotificationPolicy,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const conversation of conversations) {
    const unread = unreadByConversation.get(conversation.id) ?? 0;
    const mentions = mentionsByConversation.get(conversation.id) ?? 0;
    if (!unread && !mentions) continue;
    const count = visibleUnread(policyFor(conversation), unread, mentions);
    if (count > 0) out.set(conversation.id, count);
  }
  return out;
}

/** The soonest time a running mute ends, for re-rendering when it does. */
export function nextMuteExpiry(settings: NotificationSettings, now: number): number | null {
  let soonest: number | null = null;
  for (const setting of [...Object.values(settings.servers), ...Object.values(settings.conversations)]) {
    if (!setting.muted || !setting.mutedUntil) continue;
    const at = Date.parse(setting.mutedUntil);
    if (at > now && (soonest === null || at < soonest)) soonest = at;
  }
  return soonest;
}

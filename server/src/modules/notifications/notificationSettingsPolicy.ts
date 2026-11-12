// Pure rules of per-server and per-channel/DM notification settings, shared by push delivery and the
// app badge. Mirrored on the client in web/src/features/notifications/notificationSettings.ts (sounds and
// unread badges), and both are pinned by the same cases in their tests.

export const NOTIFICATION_LEVELS = ['all', 'mentions', 'nothing'] as const;
export type NotificationLevel = typeof NOTIFICATION_LEVELS[number];

/** What a mute may last, in minutes; 'forever' lasts until the person turns it off. */
export const MUTE_DURATIONS_MINUTES = [15, 60, 480, 1440] as const;
export type MuteDuration = typeof MUTE_DURATIONS_MINUTES[number] | 'forever';

export interface NotificationSetting {
  /** null inherits: a channel from its server, a server or a DM from "all". */
  level: NotificationLevel | null;
  muted: boolean;
  /** Only read while `muted`; null there means until turned off. */
  mutedUntil: Date | null;
}

export interface NotificationPolicy { level: NotificationLevel; muted: boolean }

export const isNotificationLevel = (value: unknown): value is NotificationLevel =>
  typeof value === 'string' && (NOTIFICATION_LEVELS as readonly string[]).includes(value);

export const isMuteDuration = (value: unknown): value is MuteDuration =>
  value === 'forever' || (MUTE_DURATIONS_MINUTES as readonly unknown[]).includes(value);

export function isMutedNow(setting: NotificationSetting | null | undefined, now: Date): boolean {
  return !!setting?.muted && (setting.mutedUntil === null || setting.mutedUntil.getTime() > now.getTime());
}

/** A channel's level wins over its server's, which wins over "all". A mute is not a level: muting a server
 * silences every channel in it, whatever level a channel picked, and a channel can be muted on its own.
 * A DM has no server, so the caller passes none. */
export function resolveNotificationPolicy(
  input: { conversation?: NotificationSetting | null; server?: NotificationSetting | null },
  now: Date,
): NotificationPolicy {
  return {
    level: input.conversation?.level ?? input.server?.level ?? 'all',
    muted: isMutedNow(input.conversation, now) || isMutedNow(input.server, now),
  };
}

/** Whether a message gets a push and a sound. Mentions still reach the notification list and badges
 * whatever this says; that is the client's and countAppBadge's business. */
export function policyAlerts(policy: NotificationPolicy, mentioned: boolean): boolean {
  if (policy.muted) return false;
  return policy.level === 'all' || (policy.level === 'mentions' && mentioned);
}

export interface NotificationSettingChange {
  /** null goes back to inheriting. */
  level?: NotificationLevel | null;
  /** false unmutes. */
  mute?: MuteDuration | false;
}

/** The setting after one change from the menu. An expired mute reads as no mute, so it is dropped too. */
export function applyNotificationChange(current: NotificationSetting | null, change: NotificationSettingChange, now: Date): NotificationSetting {
  const base: NotificationSetting = current && isMutedNow(current, now) ? current : { level: current?.level ?? null, muted: false, mutedUntil: null };
  const level = change.level === undefined ? base.level : change.level;
  if (change.mute === undefined) return { ...base, level };
  if (change.mute === false) return { level, muted: false, mutedUntil: null };
  return {
    level, muted: true,
    mutedUntil: change.mute === 'forever' ? null : new Date(now.getTime() + change.mute * 60_000),
  };
}

/** A setting that says nothing: its row is deleted rather than kept. */
export const isDefaultSetting = (setting: NotificationSetting, now: Date): boolean => setting.level === null && !isMutedNow(setting, now);

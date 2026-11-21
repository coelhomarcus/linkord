// What an account is playing or using right now, as its desktop app reports it, and what the
// account allows others to see of it. A leaf module (no imports back into presence), like
// userStatus.ts, so participants.ts can ask for an account's visible activity without a cycle;
// receiving, saving and announcing live in presenceStatus.ts.
//
// Only the desktop app detects anything, and only programs on its own list (desktop/src/main/
// activityCatalog.ts) and the Steam game Steam says is running: the report carries a key and a
// name, never a process name, so nothing outside that list ever leaves the computer.

type ActivityKind = 'playing' | 'using';

export interface Activity {
  /** what the activity is, the same on every computer: `steam:<app id>` or a catalog key */
  key: string;
  kind: ActivityKind;
  name: string;
  /** an icon stored on this server (activity/activityIcons.ts: a game's SteamGridDB icon or a program's own), or null */
  icon: string | null;
  /** ISO time it started */
  startedAt: string;
}

export interface ActivitySettings {
  /** whether others see the activity at all; on for every account until turned off */
  sharing: boolean;
  /** keys never shown */
  hidden: string[];
}

export const DEFAULT_ACTIVITY_SETTINGS: ActivitySettings = { sharing: true, hidden: [] };
export const HIDDEN_ACTIVITIES_MAX = 200;
const ACTIVITY_NAME_MAX = 64;
const KEY = /^[a-z0-9][a-z0-9:._-]{0,79}$/;
const LOCAL_ICON = /^[0-9a-f]{64}$/;
// a start further back than this is a clock gone wrong, not a week-long session
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// a report sent again (after a reconnect, a hidden key shown again) lands a little later than the first
// one: a start this close to the one already shown is the same start, not a new session
const SAME_START_MS = 5_000;

const settings = new Map<string, ActivitySettings>();

export function getActivitySettings(userId: string): ActivitySettings {
  return settings.get(userId) ?? DEFAULT_ACTIVITY_SETTINGS;
}

export function hasActivitySettings(userId: string): boolean {
  return settings.has(userId);
}

export function setActivitySettings(userId: string, value: ActivitySettings): void {
  settings.set(userId, value);
}

export function forgetActivitySettings(userId: string): void {
  settings.delete(userId);
}

export function isActivityKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value);
}

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const s = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, ACTIVITY_NAME_MAX).join('').trim();
}

// Tabs from before game icons still send `{ igdb: <cover id> }`: a portrait cover cropped square is
// not an icon, so it shows as none (the glyph) until they reload.
function iconPath(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const { local } = value as { local?: unknown };
  if (typeof local === 'string' && LOCAL_ICON.test(local)) return `/api/activity/icons/${local}.webp`;
  return null;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * An `activity-set` report, or null for "nothing" (and for anything malformed). The start is the
 * reporting computer's clock, which may be hours off (a dual-boot PC keeping local time in the
 * hardware clock is off by the time zone). A report with `sentAt` (protocol 27), that same clock when
 * it was sent, is read as a duration and placed on this server's clock; an older one is taken as is.
 */
export function sanitizeActivityReport(raw: unknown, now = Date.now()): Activity | null {
  if (!raw || typeof raw !== 'object') return null;
  const report = raw as { key?: unknown; kind?: unknown; name?: unknown; icon?: unknown; startedAt?: unknown; sentAt?: unknown };
  if (!isActivityKey(report.key) || (report.kind !== 'playing' && report.kind !== 'using')) return null;
  const name = sanitizeName(report.name);
  if (!name) return null;
  let reported = finite(report.startedAt) ? report.startedAt : now;
  if (finite(report.startedAt) && finite(report.sentAt)) reported = now - (report.sentAt - report.startedAt);
  const startedAt = reported > now || reported < now - MAX_AGE_MS ? now : reported;
  return { key: report.key, kind: report.kind, name, icon: iconPath(report.icon), startedAt: new Date(startedAt).toISOString() };
}

/** The new report, keeping the start already shown when it is the same activity reported again. */
export function keepActivityStart(previous: Activity | null | undefined, next: Activity | null): Activity | null {
  if (!previous || !next || previous.key !== next.key || previous.kind !== next.kind) return next;
  return Math.abs(Date.parse(previous.startedAt) - Date.parse(next.startedAt)) < SAME_START_MS ? { ...next, startedAt: previous.startedAt } : next;
}

/** An `activity-settings-set` body over the current settings, or null when it is not one. */
export function sanitizeActivitySettings(raw: unknown, current: ActivitySettings): ActivitySettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as { sharing?: unknown; hidden?: unknown };
  const hasSharing = typeof body.sharing === 'boolean';
  const hasHidden = Array.isArray(body.hidden);
  if (!hasSharing && !hasHidden) return null;
  const hidden = hasHidden
    ? [...new Set((body.hidden as unknown[]).filter(isActivityKey))].slice(0, HIDDEN_ACTIVITIES_MAX)
    : current.hidden;
  return { sharing: hasSharing ? body.sharing as boolean : current.sharing, hidden };
}

/** What others may see of a reported activity under the account's settings. */
export function shownActivity(activity: Activity | null, value: ActivitySettings): Activity | null {
  if (!activity || !value.sharing || value.hidden.includes(activity.key)) return null;
  return activity;
}

export function sameActivity(a: Activity | null | undefined, b: Activity | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.key === b.key && a.kind === b.kind && a.name === b.name && a.icon === b.icon && a.startedAt === b.startedAt;
}

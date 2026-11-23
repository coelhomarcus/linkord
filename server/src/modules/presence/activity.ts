// What an account is playing or using right now, as its desktop app reports it, and what the
// account allows others to see of it. A leaf module (no imports back into presence), like
// userStatus.ts, so participants.ts can ask for an account's visible activity without a cycle;
// receiving, saving and announcing live in presenceStatus.ts.
//
// Only the desktop app detects anything, and only programs on its own list (desktop/src/main/
// activityCatalog.ts) and the Steam game Steam says is running: the report carries a key and a
// name, never a process name, so nothing outside that list ever leaves the computer. A game that
// talks Discord Rich Presence to the desktop app (`discord:<app id>` when nothing else knows it) adds
// `rich`: what the game itself says, every field checked again here.

type ActivityKind = 'playing' | 'using';

interface RichImage {
  /** an icon stored on this server, like `icon` */
  url: string;
  /** what the game shows on hover */
  text?: string;
}

/** What a game says through Discord Rich Presence ("Em partida", "Mapa: Dust II", 2 de 5). */
interface RichActivity {
  details?: string;
  state?: string;
  largeImage?: RichImage;
  smallImage?: RichImage;
  party?: { size: number; max: number };
  /** ms, this server's clock */
  timestamps?: { start?: number; end?: number };
  buttons?: { label: string; url: string }[];
}

export interface Activity {
  /** what the activity is, the same on every computer: `steam:<app id>` or a catalog key */
  key: string;
  kind: ActivityKind;
  name: string;
  /** an icon stored on this server (activity/activityIcons.ts: a game's SteamGridDB icon or a program's own), or null */
  icon: string | null;
  /** ISO time it started */
  startedAt: string;
  /** only when the game reported some (protocol 30) */
  rich?: RichActivity;
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
const RICH_TEXT_MAX = 128;
const BUTTON_LABEL_MAX = 32;
const BUTTON_URL_MAX = 512;
const BUTTONS_MAX = 2;
const PARTY_MAX = 1_000_000;
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

function sanitizeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const s = value.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, max).join('').trim();
}

const sanitizeName = (value: unknown): string => sanitizeText(value, ACTIVITY_NAME_MAX);

// Tabs from before game icons still send `{ igdb: <cover id> }`: a portrait cover cropped square is
// not an icon, so it shows as none (the glyph) until they reload.
function iconPath(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const { local } = value as { local?: unknown };
  if (typeof local === 'string' && LOCAL_ICON.test(local)) return `/api/activity/icons/${local}.webp`;
  return null;
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function richImage(value: unknown): RichImage | undefined {
  const url = iconPath(value);
  if (!url) return undefined;
  const text = sanitizeText((value as { text?: unknown }).text, RICH_TEXT_MAX);
  return text ? { url, text } : { url };
}

function richParty(value: unknown): RichActivity['party'] {
  if (!value || typeof value !== 'object') return undefined;
  const { size, max } = value as { size?: unknown; max?: unknown };
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(max)) return undefined;
  const [s, m] = [size as number, max as number];
  return s >= 1 && s <= m && m <= PARTY_MAX ? { size: s, max: m } : undefined;
}

function buttonUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > BUTTON_URL_MAX) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) return null;
    return url.href.length <= BUTTON_URL_MAX ? url.href : null;
  } catch {
    return null;
  }
}

function richButtons(value: unknown): RichActivity['buttons'] {
  if (!Array.isArray(value)) return undefined;
  const buttons: { label: string; url: string }[] = [];
  for (const item of value.slice(0, BUTTONS_MAX)) {
    if (!item || typeof item !== 'object') continue;
    const label = sanitizeText((item as { label?: unknown }).label, BUTTON_LABEL_MAX);
    const url = buttonUrl((item as { url?: unknown }).url);
    if (label && url) buttons.push({ label, url });
  }
  return buttons.length ? buttons : undefined;
}

/** The game's own start and end, placed on this server's clock the same way as `startedAt`; a start in
 * the future or more than a week back, or an end already past or more than a week ahead, is a clock gone
 * wrong (or seconds read as milliseconds) and is dropped rather than shown. */
function richTimestamps(value: unknown, sentAt: unknown, now: number): RichActivity['timestamps'] {
  if (!value || typeof value !== 'object') return undefined;
  const { start, end } = value as { start?: unknown; end?: unknown };
  const place = (at: unknown): number | null => {
    if (!finite(at)) return null;
    return Math.round(finite(sentAt) ? now - (sentAt - at) : at);
  };
  const placedStart = place(start);
  const placedEnd = place(end);
  const timestamps: { start?: number; end?: number } = {};
  if (placedStart !== null && placedStart <= now && placedStart >= now - MAX_AGE_MS) timestamps.start = placedStart;
  if (placedEnd !== null && placedEnd > now && placedEnd <= now + MAX_AGE_MS && (timestamps.start === undefined || placedEnd > timestamps.start)) {
    timestamps.end = placedEnd;
  }
  return timestamps.start !== undefined || timestamps.end !== undefined ? timestamps : undefined;
}

/** What is left of a report's `rich`, or undefined when nothing valid is. */
function sanitizeRich(raw: unknown, sentAt: unknown, now: number): RichActivity | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const report = raw as Record<string, unknown>;
  const rich: RichActivity = {};
  const details = sanitizeText(report.details, RICH_TEXT_MAX);
  if (details) rich.details = details;
  const state = sanitizeText(report.state, RICH_TEXT_MAX);
  if (state) rich.state = state;
  const largeImage = richImage(report.largeImage);
  if (largeImage) rich.largeImage = largeImage;
  const smallImage = richImage(report.smallImage);
  if (smallImage) rich.smallImage = smallImage;
  const party = richParty(report.party);
  if (party) rich.party = party;
  const timestamps = richTimestamps(report.timestamps, sentAt, now);
  if (timestamps) rich.timestamps = timestamps;
  const buttons = richButtons(report.buttons);
  if (buttons) rich.buttons = buttons;
  return Object.keys(rich).length ? rich : undefined;
}

/**
 * An `activity-set` report, or null for "nothing" (and for anything malformed). The start is the
 * reporting computer's clock, which may be hours off (a dual-boot PC keeping local time in the
 * hardware clock is off by the time zone). A report with `sentAt` (protocol 27), that same clock when
 * it was sent, is read as a duration and placed on this server's clock; an older one is taken as is.
 */
export function sanitizeActivityReport(raw: unknown, now = Date.now()): Activity | null {
  if (!raw || typeof raw !== 'object') return null;
  const report = raw as { key?: unknown; kind?: unknown; name?: unknown; icon?: unknown; startedAt?: unknown; sentAt?: unknown; rich?: unknown };
  if (!isActivityKey(report.key) || (report.kind !== 'playing' && report.kind !== 'using')) return null;
  const name = sanitizeName(report.name);
  if (!name) return null;
  let reported = finite(report.startedAt) ? report.startedAt : now;
  if (finite(report.startedAt) && finite(report.sentAt)) reported = now - (report.sentAt - report.startedAt);
  const startedAt = reported > now || reported < now - MAX_AGE_MS ? now : reported;
  const activity: Activity = { key: report.key, kind: report.kind, name, icon: iconPath(report.icon), startedAt: new Date(startedAt).toISOString() };
  const rich = sanitizeRich(report.rich, report.sentAt, now);
  return rich ? { ...activity, rich } : activity;
}

const close = (a: number | undefined, b: number | undefined): boolean => a !== undefined && b !== undefined && Math.abs(a - b) < SAME_START_MS;

/** The new report, keeping the start already shown when it is the same activity reported again. A game
 * reports its rich presence again every few seconds, each time placed with a slightly different delay:
 * its timestamps that moved by less than that delay are kept too, or every report would be news. */
export function keepActivityStart(previous: Activity | null | undefined, next: Activity | null): Activity | null {
  if (!previous || !next || previous.key !== next.key || previous.kind !== next.kind) return next;
  let kept = next;
  if (Math.abs(Date.parse(previous.startedAt) - Date.parse(next.startedAt)) < SAME_START_MS) kept = { ...kept, startedAt: previous.startedAt };
  const before = previous.rich?.timestamps;
  const after = next.rich?.timestamps;
  if (before && after && next.rich) {
    const start = close(before.start, after.start) ? before.start : after.start;
    const end = close(before.end, after.end) ? before.end : after.end;
    if (start !== after.start || end !== after.end) {
      const timestamps = { ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) };
      kept = { ...kept, rich: { ...next.rich, timestamps } };
    }
  }
  return kept;
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
  return a.key === b.key && a.kind === b.kind && a.name === b.name && a.icon === b.icon && a.startedAt === b.startedAt && sameValue(a.rich, b.rich);
}

/** Deep equality of plain JSON-like values; a missing key and an undefined one are the same. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === (b as unknown[]).length && a.every((item, i) => sameValue(item, (b as unknown[])[i]));
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) if (!sameValue(left[key], right[key])) return false;
  return true;
}

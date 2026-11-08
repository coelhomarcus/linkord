// The presence status an account picked and its custom status, kept in memory while the account has a
// connection. A leaf module (no imports back into presence) so participants.ts can ask "is this account
// invisible?" without a cycle; loading, saving and announcing live in presenceStatus.ts.

export const PRESENCE_STATUSES = ['online', 'idle', 'dnd', 'invisible'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];
/** What other people can see: invisible reads as offline, so it is never shown. */
export type VisibleStatus = Exclude<PresenceStatus, 'invisible'>;

export interface CustomStatus {
  emoji: string;
  text: string;
  /** ISO time it stops showing, null for never */
  expiresAt: string | null;
}

export interface AccountStatus {
  status: PresenceStatus;
  customStatus: CustomStatus | null;
}

export const CUSTOM_STATUS_TEXT_MAX = 128;
/** The longest expiry a client may ask for; the editor offers "today" at most. */
export const CUSTOM_STATUS_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_STATUS: AccountStatus = { status: 'online', customStatus: null };
const statuses = new Map<string, AccountStatus>();

export function isPresenceStatus(value: unknown): value is PresenceStatus {
  return typeof value === 'string' && (PRESENCE_STATUSES as readonly string[]).includes(value);
}

export function getAccountStatus(userId: string): AccountStatus {
  return statuses.get(userId) ?? DEFAULT_STATUS;
}

export function hasAccountStatus(userId: string): boolean {
  return statuses.has(userId);
}

export function setAccountStatus(userId: string, value: AccountStatus): void {
  statuses.set(userId, value);
}

export function forgetAccountStatus(userId: string): void {
  statuses.delete(userId);
}

export function isInvisible(userId: string): boolean {
  return getAccountStatus(userId).status === 'invisible';
}

/** "Online" turns into "idle" only when every live connection reported no activity: someone
 * typing on their phone is not away just because a desktop tab sits untouched. A chosen idle,
 * dnd or invisible always wins over activity. */
export function effectiveStatus(chosen: PresenceStatus, everyConnectionIdle: boolean): PresenceStatus {
  return chosen === 'online' && everyConnectionIdle ? 'idle' : chosen;
}

const EMOJI_PART = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|‍|️|⃣|[#*0-9]|[\u{E0020}-\u{E007F}])+$/u;
const EMOJI_BASE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** One emoji (a single grapheme, ZWJ sequences and flags included), or '' for anything else. */
export function sanitizeStatusEmoji(value: unknown): string {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!s || s.length > 32 || !EMOJI_PART.test(s) || !EMOJI_BASE.test(s)) return '';
  let graphemes = 0;
  for (const _ of segmenter.segment(s)) if (++graphemes > 1) return '';
  return s;
}

/** Single line, collapsed whitespace, at most CUSTOM_STATUS_TEXT_MAX characters (not UTF-16 units). */
export function sanitizeStatusText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const s = value.replace(/[\p{Cc}\p{Cf}]/gu, (ch) => (ch === '‍' ? ch : ' ')).replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, CUSTOM_STATUS_TEXT_MAX).join('').trim();
}

/** The custom status a client asked for, or null to clear it. An expiry in the past means the
 * request is stale (sent before it would have expired anyway): it clears too. A far expiry is
 * clamped rather than refused, so a skewed client clock still sets something sensible. */
export function sanitizeCustomStatus(raw: unknown, now = Date.now()): CustomStatus | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as { emoji?: unknown; text?: unknown; expiresAt?: unknown };
  const emoji = sanitizeStatusEmoji(body.emoji);
  const text = sanitizeStatusText(body.text);
  if (!emoji && !text) return null;
  let expiresAt: string | null = null;
  if (body.expiresAt != null) {
    const at = typeof body.expiresAt === 'string' ? Date.parse(body.expiresAt) : NaN;
    if (!Number.isFinite(at) || at <= now) return null;
    expiresAt = new Date(Math.min(at, now + CUSTOM_STATUS_MAX_TTL_MS)).toISOString();
  }
  return { emoji, text, expiresAt };
}

export function isCustomStatusExpired(custom: CustomStatus | null, now = Date.now()): boolean {
  return !!custom?.expiresAt && Date.parse(custom.expiresAt) <= now;
}

export function sameCustomStatus(a: CustomStatus | null, b: CustomStatus | null): boolean {
  if (!a || !b) return a === b;
  return a.emoji === b.emoji && a.text === b.text && a.expiresAt === b.expiresAt;
}

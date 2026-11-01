import { i18n } from '@/shared/i18n/init';
import { ApiError } from '@/shared/api/api';
import type { FriendRequestOutcome } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';

/** "  @Lune " → "Lune". The server lowercases for lookup itself
 * (users.ts#findByUsernameLower), so this only strips what a person naturally
 * types around a handle. */
export function normalizeUsernameInput(raw: string): string {
  return raw.trim().replace(/^@+/, '').trim();
}

export function formatRetryAfter(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(i18n.language, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function describeSendError(err: unknown): string {
  if (err instanceof ApiError) {
    // one deliberately generic answer for "doesn't exist" AND "can't be
    // reached" — the server never says which (a block must not be revealed)
    if (err.code === ERROR_CODES.user_unavailable) return i18n.t('friends:send.unavailable');
    if (err.code === ERROR_CODES.cooldown) {
      const when = err.retryAfter ? formatRetryAfter(err.retryAfter) : '';
      return when ? i18n.t('friends:send.cooldownAt', { when }) : i18n.t('friends:send.cooldown');
    }
    if (err.code === ERROR_CODES.rate_limited || err.code === ERROR_CODES.quota_exceeded) return err.message;
  }
  return i18n.t('friends:send.failed');
}

export function describeOutcome(outcome: FriendRequestOutcome, username: string): { text: string; tone: 'success' | 'info' } {
  const text = i18n.t(`friends:send.${outcome}`, { username });
  return { text, tone: outcome === 'created' ? 'success' : 'info' };
}

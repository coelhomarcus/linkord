import { ApiError } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { i18n } from '@/shared/i18n/init';

export const REASON_MIN = 3;
export const REASON_MAX = 500;

/** Mirrors the server's normalizeReason: whitespace runs collapse to one space, so
 * what the form validates is what the server will accept (and store). */
export function normalizeReasonText(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/** The server refused because the entity is no longer in the state the admin was
 * looking at (409), or is gone (404): what is on screen is out of date. */
export function isStaleStateError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 409 || status === 404;
}

export function describeAdminError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case ERROR_CODES.reason_required: return i18n.t('admin:errors.reasonRequired');
      case ERROR_CODES.self_action: return i18n.t('admin:errors.selfAction');
      case ERROR_CODES.last_admin: return i18n.t('admin:errors.lastAdmin');
      case ERROR_CODES.confirmation_mismatch: return i18n.t('admin:errors.confirmationMismatch');
      case ERROR_CODES.already_admin: return i18n.t('admin:errors.alreadyAdmin');
      case ERROR_CODES.not_admin: return i18n.t('admin:errors.notAdmin');
      case ERROR_CODES.target_inactive: return i18n.t('admin:errors.targetInactive');
      case ERROR_CODES.already_suspended: return i18n.t('admin:errors.alreadySuspended');
      case ERROR_CODES.not_suspended: return i18n.t('admin:errors.notSuspended');
      case ERROR_CODES.already_closed: return i18n.t('admin:errors.alreadyClosed');
      case ERROR_CODES.not_open: return i18n.t('admin:errors.notOpen');
      case ERROR_CODES.invalid_action: return i18n.t('admin:errors.invalidAction');
      case ERROR_CODES.action_failed: return i18n.t('admin:errors.actionFailed');
      case ERROR_CODES.not_member: return i18n.t('admin:errors.notMember');
      case ERROR_CODES.forbidden: return i18n.t('admin:errors.forbidden');
      case ERROR_CODES.rate_limited: return i18n.t('admin:errors.rateLimited');
      default: if (err.message) return err.message;
    }
  }
  return i18n.t('admin:errors.generic');
}

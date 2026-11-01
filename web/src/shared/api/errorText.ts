import { i18n } from '@/shared/i18n/init';
import { ApiError } from './api';

/** Converts stable API codes into active-language copy while preserving server
 * text when it carries a quota, retry, or other dynamic detail. */
export function describeApiError(error: unknown, fallbackKey = 'errors.unexpected'): string {
  if (!(error instanceof ApiError)) return i18n.t(fallbackKey as never);
  if (error.code === 'quota_exceeded' || error.retryAfter || !i18n.exists(`errors.codes.${error.code}`)) return error.message || i18n.t(fallbackKey as never);
  return i18n.t(`errors.codes.${error.code}` as never, { defaultValue: error.message || i18n.t(fallbackKey as never) });
}

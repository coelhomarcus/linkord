import { ApiError } from '@/shared/api/api';
import { i18n } from '@/shared/i18n/init';

/** What to tell someone whose connection could not be saved, wherever they tried to connect it. */
export function describeConnectionError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'invalid_connection': return i18n.t('profile:integration.errors.invalid');
      case 'connection_exists': return i18n.t('profile:integration.errors.duplicate');
      case 'quota_exceeded': return i18n.t('profile:integration.errors.limit');
      case 'connection_not_found': return i18n.t('profile:integration.errors.missing');
      case 'rate_limited': return i18n.t('profile:integration.errors.rateLimited');
    }
  }
  return i18n.t('profile:integration.errors.failed');
}

import { i18n } from '@/shared/i18n/init';
import { timeOptions, type TimeFormat } from '@/shared/lib/timeFormat';

/** "Muted until 12 Nov, 21:05" (the day always, as a mute can end tomorrow), or until turned back on. */
export function mutedUntilText(iso: string | null, language: string, timeFormat: TimeFormat): string {
  if (!iso) return i18n.t('notifications:preferences.mutedForever', { lng: language });
  const time = new Date(iso).toLocaleString(language, { day: 'numeric', month: 'short', ...timeOptions(language, timeFormat) });
  return i18n.t('notifications:preferences.mutedUntil', { time, lng: language });
}

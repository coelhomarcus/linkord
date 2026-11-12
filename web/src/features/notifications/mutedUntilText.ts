import { i18n } from '@/shared/i18n/init';
import { timeOptions } from '@/shared/lib/timeFormat';

/** "Muted until 12 Nov, 21:05" (the day always, as a mute can end tomorrow), or until turned back on. */
export function mutedUntilText(iso: string | null): string {
  if (!iso) return i18n.t('notifications:preferences.mutedForever');
  const time = new Date(iso).toLocaleString(i18n.language, { day: 'numeric', month: 'short', ...timeOptions(i18n.language) });
  return i18n.t('notifications:preferences.mutedUntil', { time });
}

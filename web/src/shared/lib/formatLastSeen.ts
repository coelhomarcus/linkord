import { i18n } from '@/shared/i18n/init';

/** Relative "last seen" copy for a DM subtitle, in the viewer's local calendar. */

function clock(at: Date): string {
  return at.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
}

export function formatLastSeen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return i18n.t('common:lastSeen.offline');
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return i18n.t('common:lastSeen.offline');

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThat = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThat) / 86_400_000);
  const time = clock(at);

  if (dayDiff === 0) return i18n.t('common:lastSeen.today', { time });
  if (dayDiff === 1) return i18n.t('common:lastSeen.yesterday', { time });

  const date = at.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return i18n.t('common:lastSeen.date', { date, time });
}

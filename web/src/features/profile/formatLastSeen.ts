import { i18n } from '@/shared/i18n/init';

function clock(at: Date): string {
  return at.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
}

/** "ontem às 10:11", counted in the viewer's local calendar; null without a usable timestamp. */
export function formatLastSeen(iso: string | null | undefined, now: Date = new Date()): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfThat = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfThat) / 86_400_000);
  const time = clock(at);

  if (dayDiff === 0) return i18n.t('profile:lastSeen.today', { time });
  if (dayDiff === 1) return i18n.t('profile:lastSeen.yesterday', { time });

  const date = at.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return i18n.t('profile:lastSeen.date', { date, time });
}

/** The profile's presence row: the current status while connected (or with no
 * record of a last visit), otherwise when the person was last online. */
export function lastSeenField(online: boolean, lastSeenAt: string | null | undefined): { label: string; value: string } {
  if (online) return { label: i18n.t('profile:lastSeen.status'), value: i18n.t('profile:lastSeen.online') };
  const when = formatLastSeen(lastSeenAt);
  return when
    ? { label: i18n.t('profile:lastSeen.label'), value: when }
    : { label: i18n.t('profile:lastSeen.status'), value: i18n.t('profile:lastSeen.offline') };
}

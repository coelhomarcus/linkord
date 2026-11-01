import { i18n } from '@/shared/i18n/init';


function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatTime(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const time = date.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
  if (isSameDay(date, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return i18n.t('common:time.yesterdayAt', { time });
  const dateStr = date.toLocaleDateString(i18n.language, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${dateStr}, ${time}`;
}

export function formatDateHeading(ts: number): string {
  return new Date(ts).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' });
}

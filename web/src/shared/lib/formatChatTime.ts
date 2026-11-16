import { i18n } from '@/shared/i18n/init';
import { timeOptions, type TimeFormat } from '@/shared/lib/timeFormat';


function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatTime(ts: number, language: string, timeFormat: TimeFormat): string {
  const date = new Date(ts);
  const now = new Date();
  const time = date.toLocaleTimeString(language, timeOptions(language, timeFormat));
  if (isSameDay(date, now)) return time;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(date, yesterday)) return i18n.t('common:time.yesterdayAt', { time, lng: language });
  const dateStr = date.toLocaleDateString(language, { day: '2-digit', month: '2-digit', year: 'numeric' });
  return `${dateStr}, ${time}`;
}

export function formatDateHeading(ts: number, language: string): string {
  return new Date(ts).toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' });
}

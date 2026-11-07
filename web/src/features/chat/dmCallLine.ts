import type { TFunction } from 'i18next';

/** Talk time as a phrase. Values under a minute stay in seconds; the rest is floored. */
export function formatCallLength(totalSeconds: number, t: TFunction<'chat'>): string {
  const seconds = Math.max(1, Math.floor(totalSeconds));
  if (seconds < 60) return t('dmCall.second', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('dmCall.minute', { count: minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourText = t('dmCall.hour', { count: hours });
  if (remainder === 0) return hourText;
  return t('dmCall.hourMinute', { hours: hourText, minutes: t('dmCall.minute', { count: remainder }) });
}

/** The sentence one reader sees. The caller reads "Você"; everyone else reads the caller's name. */
export function dmCallLine(input: {
  viewerId: string | null;
  callerId: string | null;
  callerName: string;
  durationSeconds: number | null;
}, t: TFunction<'chat'>): string {
  const mine = !!input.viewerId && input.viewerId === input.callerId;
  const name = input.callerName || t('dmCall.someone');
  if (input.durationSeconds == null) return mine ? t('dmCall.you') : t('dmCall.them', { name });
  const duration = formatCallLength(input.durationSeconds, t);
  return mine ? t('dmCall.youLasted', { duration }) : t('dmCall.themLasted', { name, duration });
}

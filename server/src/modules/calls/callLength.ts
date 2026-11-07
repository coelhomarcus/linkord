import type { Locale } from '../users/locale.js';
import { localeText } from '../users/localeText.js';

/** Talk time as a phrase. Same boundaries as the chat line: seconds, then floored minutes and hours. */
export function formatCallLength(totalSeconds: number, locale: Locale): string {
  const seconds = Math.max(1, Math.floor(totalSeconds));
  if (seconds < 60) return localeText(locale, seconds === 1 ? 'push.callSecond_one' : 'push.callSecond_other', { count: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return localeText(locale, minutes === 1 ? 'push.callMinute_one' : 'push.callMinute_other', { count: minutes });
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const hourText = localeText(locale, hours === 1 ? 'push.callHour_one' : 'push.callHour_other', { count: hours });
  if (remainder === 0) return hourText;
  const minuteText = localeText(locale, remainder === 1 ? 'push.callMinute_one' : 'push.callMinute_other', { count: remainder });
  return localeText(locale, 'push.callHourMinute', { hours: hourText, minutes: minuteText });
}

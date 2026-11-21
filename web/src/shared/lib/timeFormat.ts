import { getPreference, setPreference, usePreferenceValue } from '@/shared/preferences/accountPreferences';

/** 'auto' follows the interface language (24h in pt-BR, 12h in en-US). */
export type TimeFormat = 'auto' | '12h' | '24h';
export const TIME_FORMATS: readonly TimeFormat[] = ['auto', '12h', '24h'];

export function getTimeFormat(): TimeFormat {
  const raw = getPreference('timeFormat');
  return raw === '12h' || raw === '24h' ? raw : 'auto';
}

export function setTimeFormat(value: TimeFormat): void {
  setPreference('timeFormat', value === 'auto' ? null : value);
}

/** Hour and minute options for toLocale*String. A 12-hour clock reads "9:05 PM",
 * a 24-hour one "21:05" / "09:05": the leading zero only belongs to the latter. */
export function timeOptions(language: string, format: TimeFormat): Intl.DateTimeFormatOptions {
  const twelve = format === 'auto'
    ? new Intl.DateTimeFormat(language, { hour: 'numeric' }).resolvedOptions().hour12 ?? false
    : format === '12h';
  return { hour: twelve ? 'numeric' : '2-digit', minute: '2-digit', hour12: twelve };
}

/** Re-renders whoever prints a time when the format changes, here or on another device. */
export function useTimeFormat(): TimeFormat {
  return usePreferenceValue(getTimeFormat);
}

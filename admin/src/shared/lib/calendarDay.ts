/** A calendar day as `yyyy-mm-dd`, in the viewer's own time zone. The string
 * sorts like the day it names, so bounds compare with `<` and `>`. */
export type DayKey = string;

export function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  // 2026-02-31 would silently roll over to March: reject it instead
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

export function toDayKey(date: Date): DayKey {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export const todayKey = (): DayKey => toDayKey(new Date());

export function addDays(key: DayKey, days: number): DayKey {
  const date = parseDayKey(key)!;
  return toDayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days));
}

/** Same day of another month, or that month's last day when it is shorter (Jan 31 + 1 → Feb 28). */
export function addMonths(key: DayKey, months: number): DayKey {
  const date = parseDayKey(key)!;
  const lastDay = new Date(date.getFullYear(), date.getMonth() + months + 1, 0).getDate();
  return toDayKey(new Date(date.getFullYear(), date.getMonth() + months, Math.min(date.getDate(), lastDay)));
}

export function clampDay(key: DayKey, min?: DayKey, max?: DayKey): DayKey {
  if (min && key < min) return min;
  if (max && key > max) return max;
  return key;
}

// Where Intl.Locale has no week data (Firefox), the regions whose weeks start on Sunday; the rest start on Monday.
const SUNDAY_FIRST = new Set(['US', 'CA', 'BR', 'MX', 'JP', 'KR', 'TW', 'HK', 'IL', 'IN', 'PH', 'ZA', 'PE', 'CO', 'VE', 'GT', 'PR']);

/** First day of the week for a language (0 = Sunday … 6 = Saturday). */
export function firstDayOfWeek(language: string): number {
  try {
    const locale = new Intl.Locale(language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    // Intl numbers the days 1 (Monday) to 7 (Sunday)
    if (info) return info.firstDay % 7;
    const region = locale.maximize().region;
    return region && SUNDAY_FIRST.has(region) ? 0 : 1;
  } catch {
    return 0;
  }
}

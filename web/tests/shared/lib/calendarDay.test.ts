import { describe, expect, it } from 'vitest';
import { addDays, addMonths, clampDay, firstDayOfWeek, parseDayKey, toDayKey } from '@/shared/lib/calendarDay';

describe('calendarDay', () => {
  it('reads and writes local days, rejecting ones that do not exist', () => {
    expect(toDayKey(parseDayKey('2026-03-09')!)).toBe('2026-03-09');
    expect(parseDayKey('2026-02-31')).toBeNull();
    expect(parseDayKey('2026-3-9')).toBeNull();
    expect(parseDayKey('')).toBeNull();
  });

  it('moves across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addMonths('2026-03-15', -12)).toBe('2025-03-15');
  });

  it('a month shorter than the day lands on its last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('clamps to whichever bound is set', () => {
    expect(clampDay('2026-03-01', '2026-03-05')).toBe('2026-03-05');
    expect(clampDay('2026-03-30', undefined, '2026-03-20')).toBe('2026-03-20');
    expect(clampDay('2026-03-10', '2026-03-05', '2026-03-20')).toBe('2026-03-10');
  });

  it('takes the first day of the week from the language', () => {
    expect(firstDayOfWeek('pt-BR')).toBe(0);
    expect(firstDayOfWeek('en-US')).toBe(0);
    expect(firstDayOfWeek('en-GB')).toBe(1);
    expect(firstDayOfWeek('de-DE')).toBe(1);
  });
});

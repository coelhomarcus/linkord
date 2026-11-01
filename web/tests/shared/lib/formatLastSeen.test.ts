import { describe, expect, it } from 'vitest';
import { formatLastSeen } from '@/shared/lib/formatLastSeen';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

const now = new Date(2026, 9, 24, 18, 0, 0);

describe('formatLastSeen', () => {
  it('returns Offline when there is no timestamp', () => {
    expect(formatLastSeen(null, now)).toBe('Offline');
    expect(formatLastSeen(undefined, now)).toBe('Offline');
    expect(formatLastSeen('not-a-date', now)).toBe('Offline');
  });

  it('uses today / yesterday / a calendar date in the local timezone', () => {
    expect(formatLastSeen(new Date(2026, 9, 24, 14, 32).toISOString(), now)).toBe('Última vez online hoje às 14:32');
    expect(formatLastSeen(new Date(2026, 9, 23, 9, 10).toISOString(), now)).toBe('Última vez online ontem às 09:10');
    expect(formatLastSeen(new Date(2026, 2, 12, 18, 0).toISOString(), now)).toBe('Última vez online em 12/03/2026 às 18:00');
  });
});

describe('formatLastSeen in English', () => {
  useLanguageForTests('en-US');

  it('words the calendar day in English and formats the clock and date for the locale', () => {
    expect(formatLastSeen(null, now)).toBe('Offline');
    // ICU puts a narrow no-break space before PM in newer versions
    const plain = (text: string) => text.replace(/\s/g, ' ');
    expect(plain(formatLastSeen(new Date(2026, 9, 24, 14, 32).toISOString(), now))).toBe('Last seen online today at 02:32 PM');
    expect(plain(formatLastSeen(new Date(2026, 2, 12, 18, 0).toISOString(), now))).toBe('Last seen online on 03/12/2026 at 06:00 PM');
  });
});

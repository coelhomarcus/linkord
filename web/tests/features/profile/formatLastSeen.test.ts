import { describe, expect, it } from 'vitest';
import { formatLastSeen, lastSeenField } from '@/features/profile/formatLastSeen';
import { useLanguageForTests } from '@tests/fixtures/i18nFixture';

const now = new Date(2026, 9, 24, 18, 0, 0);

describe('formatLastSeen', () => {
  it('returns null when there is no usable timestamp', () => {
    expect(formatLastSeen(null, now)).toBeNull();
    expect(formatLastSeen(undefined, now)).toBeNull();
    expect(formatLastSeen('not-a-date', now)).toBeNull();
  });

  it('uses today / yesterday / a calendar date in the local timezone', () => {
    expect(formatLastSeen(new Date(2026, 9, 24, 14, 32).toISOString(), now)).toBe('hoje às 14:32');
    expect(formatLastSeen(new Date(2026, 9, 23, 9, 10).toISOString(), now)).toBe('ontem às 09:10');
    expect(formatLastSeen(new Date(2026, 2, 12, 18, 0).toISOString(), now)).toBe('12/03/2026 às 18:00');
  });
});

describe('lastSeenField', () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(10, 11, 0, 0);

  it('shows the current status while online, even with a past timestamp', () => {
    expect(lastSeenField(true, yesterday.toISOString())).toEqual({ label: 'Status', value: 'Online' });
  });

  it('shows when the person was last online while offline', () => {
    expect(lastSeenField(false, yesterday.toISOString())).toEqual({ label: 'Última vez online', value: 'ontem às 10:11' });
  });

  it('falls back to Offline with no record of a last visit', () => {
    expect(lastSeenField(false, null)).toEqual({ label: 'Status', value: 'Offline' });
  });
});

describe('formatLastSeen in English', () => {
  useLanguageForTests('en-US');

  it('words the calendar day in English and formats the clock and date for the locale', () => {
    // ICU puts a narrow no-break space before PM in newer versions
    const plain = (text: string | null) => text?.replace(/\s/g, ' ');
    expect(plain(formatLastSeen(new Date(2026, 9, 24, 14, 32).toISOString(), now))).toBe('today at 02:32 PM');
    expect(plain(formatLastSeen(new Date(2026, 9, 23, 9, 10).toISOString(), now))).toBe('yesterday at 09:10 AM');
    expect(plain(formatLastSeen(new Date(2026, 2, 12, 18, 0).toISOString(), now))).toBe('03/12/2026 at 06:00 PM');
  });

  it('labels the field in English', () => {
    expect(lastSeenField(false, new Date(2026, 2, 12, 18, 0).toISOString()).label).toBe('Last seen online');
    expect(lastSeenField(true, null)).toEqual({ label: 'Status', value: 'Online' });
  });
});

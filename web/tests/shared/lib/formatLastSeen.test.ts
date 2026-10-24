import { describe, expect, it } from 'vitest';
import { formatLastSeen } from '@/shared/lib/formatLastSeen';

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

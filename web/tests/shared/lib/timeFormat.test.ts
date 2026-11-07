import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { formatTime } from '@/shared/lib/formatChatTime';
import { getTimeFormat, setTimeFormat, timeOptions, useTimeFormat } from '@/shared/lib/timeFormat';

afterEach(() => setTimeFormat('auto'));

function todayAt(hour: number, minute: number): number {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

describe('time format', () => {
  it('defaults to auto, which follows the language (24 hours in pt-BR)', () => {
    expect(getTimeFormat()).toBe('auto');
    expect(formatTime(todayAt(21, 5))).toBe('21:05');
  });

  it('12 hours drops the leading zero and adds the period; 24 hours keeps it', () => {
    setTimeFormat('12h');
    expect(formatTime(todayAt(9, 5))).toMatch(/^9:05\s?AM$/i);
    setTimeFormat('24h');
    expect(formatTime(todayAt(9, 5))).toBe('09:05');
  });

  it('auto in en-US is 12 hours', () => {
    expect(timeOptions('en-US', 'auto')).toMatchObject({ hour12: true, hour: 'numeric' });
    expect(timeOptions('pt-BR', 'auto')).toMatchObject({ hour12: false, hour: '2-digit' });
  });

  it('is stored, and whoever prints a time hears the change', () => {
    const { result } = renderHook(() => useTimeFormat());
    act(() => setTimeFormat('12h'));
    expect(result.current).toBe('12h');
    expect(localStorage.getItem('ss-time-format')).toBe('12h');
    act(() => setTimeFormat('auto'));
    expect(localStorage.getItem('ss-time-format')).toBeNull();
  });
});

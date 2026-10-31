import { describe, expect, it } from 'vitest';
import { formatFileSize, formatMB, formatSizeLimit } from '@/shared/lib/formatBytes';

describe('formatBytes', () => {
  it('formats a byte count at each threshold, inclusive', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    expect(formatFileSize(1024 ** 3 - 1)).toMatch(/MB$/);
    expect(formatFileSize(1024 ** 3)).toBe('1.0 GB');
    expect(formatFileSize(2 * 1024 ** 3)).toBe('2.0 GB');
  });

  it('rounds a megabyte count and treats 0 as 0MB', () => {
    expect(formatMB(12 * 1024 * 1024)).toBe('12MB');
    expect(formatMB(0)).toBe('0MB');
  });

  it('switches a size limit to GB at 1GB, so the 2GB attachment ceiling stays readable', () => {
    expect(formatSizeLimit(500 * 1024 * 1024)).toBe('500MB');
    expect(formatSizeLimit(1024 * 1024 * 1024)).toBe('1GB');
    expect(formatSizeLimit(2 * 1024 * 1024 * 1024)).toBe('2GB');
  });
});

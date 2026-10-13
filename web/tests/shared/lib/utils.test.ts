import { describe, expect, it } from 'vitest';
import { cn } from '@/shared/lib/utils';

describe('cn', () => {
  it('keeps a theme font size when a text colour follows', () => {
    expect(cn('text-label', 'text-primary-foreground')).toBe('text-label text-primary-foreground');
    expect(cn('text-caption text-red')).toBe('text-caption text-red');
  });

  it('still lets a later theme font size replace an earlier one', () => {
    expect(cn('text-label', 'text-caption')).toBe('text-caption');
    expect(cn('text-body', 'text-sm')).toBe('text-sm');
  });
});

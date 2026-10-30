import { describe, expect, it } from 'vitest';
import { canLoadMediaUrl } from '@/features/media/mediaUrl';

describe('canLoadMediaUrl', () => {
  it('skips insecure preview media on an HTTPS page', () => {
    expect(canLoadMediaUrl('http://localhost:3000/events/banner.webp', 'https:')).toBe(false);
    expect(canLoadMediaUrl('http://example.com/image.webp', 'https:')).toBe(false);
  });

  it('keeps HTTPS, same-origin and local development media available', () => {
    expect(canLoadMediaUrl('https://example.com/image.webp', 'https:')).toBe(true);
    expect(canLoadMediaUrl('/uploads/image.webp', 'https:')).toBe(true);
    expect(canLoadMediaUrl('http://localhost:3000/image.webp', 'http:')).toBe(true);
  });
});

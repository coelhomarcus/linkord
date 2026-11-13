import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxiedImageVariant, snapProxySize } from '@/shared/lib/mediaProxy';

describe('snapProxySize', () => {
  it('takes the smallest listed size that covers the pixels, capped at the largest', () => {
    expect(snapProxySize(1)).toBe(16);
    expect(snapProxySize(16)).toBe(16);
    expect(snapProxySize(17)).toBe(32);
    expect(snapProxySize(384)).toBe(400);
    expect(snapProxySize(768)).toBe(800);
    expect(snapProxySize(5000)).toBe(1920);
  });
});

describe('proxiedImageVariant', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('asks for the drawn width times the pixel density, as WebP, keeping the signed target', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    expect(proxiedImageVariant('/api/media-proxy/preview/sig?u=abc', { width: 384 })).toBe('/api/media-proxy/preview/sig?u=abc&width=800&format=webp');
  });

  it('adds a query to an id-based address and can ask for the first frame only', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    expect(proxiedImageVariant('/api/media-proxy/youtube/dQw4w9WgXcQ', { width: 100, animated: false })).toBe('/api/media-proxy/youtube/dQw4w9WgXcQ?width=128&format=webp&animated=false');
  });

  it('leaves anything that is not our proxy alone', () => {
    for (const src of ['https://ex.com/og.png', '/uploads/abc', 'data:image/png;base64,AAAA']) expect(proxiedImageVariant(src, { width: 400 })).toBe(src);
  });
});

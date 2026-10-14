import { describe, expect, it } from 'vitest';
import { embedImageBox, embedImageAspect, EMBED_IMAGE_FALLBACK_HEIGHT } from '@/features/media/embedImageBox';

describe('embedImageBox', () => {
  it('without a known size, a fixed-height box at the full width', () => {
    expect(embedImageBox(null, 384)).toEqual({ width: 384, height: EMBED_IMAGE_FALLBACK_HEIGHT });
  });

  it('treats a zero or missing side as unknown', () => {
    expect(embedImageBox({ width: 0, height: 100 }, 384)).toEqual({ width: 384, height: EMBED_IMAGE_FALLBACK_HEIGHT });
    expect(embedImageBox({ width: 100, height: 0 }, 384)).toEqual({ width: 384, height: EMBED_IMAGE_FALLBACK_HEIGHT });
  });

  it('keeps a small image at its own size: no stretching to fill the box', () => {
    expect(embedImageBox({ width: 120, height: 80 }, 384)).toEqual({ width: 120, height: 80 });
  });

  it('scales a wide image down to the width cap, keeping its proportions', () => {
    expect(embedImageBox({ width: 1000, height: 500 }, 384)).toEqual({ width: 384, height: 192 });
  });

  it('scales a tall image down to the height cap', () => {
    expect(embedImageBox({ width: 300, height: 900 }, 384)).toEqual({ width: 93, height: 280 });
  });

  it('respects a narrower surface than the usual cap', () => {
    expect(embedImageBox({ width: 800, height: 400 }, 200)).toEqual({ width: 200, height: 100 });
  });
});

describe('embedImageAspect', () => {
  it('is the ratio of a known size and null otherwise', () => {
    expect(embedImageAspect({ width: 1200, height: 630 })).toBe('1200 / 630');
    expect(embedImageAspect(null)).toBeNull();
    expect(embedImageAspect({ width: 0, height: 5 })).toBeNull();
  });
});

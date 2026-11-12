import { describe, expect, it } from 'vitest';
import {
  SWIPE,
  swipeAxis,
  edgeSwipeOriginX,
  isEdgeSwipeStart,
  isConversationEdgeStart,
} from '@/shared/lib/swipe';

describe('swipeAxis', () => {
  it('stays undecided inside the long-press lock, so a tap is not a swipe', () => {
    expect(swipeAxis(0, 0)).toBe('undecided');
    expect(swipeAxis(SWIPE.lockPx, SWIPE.lockPx)).toBe('undecided');
  });

  it('the first axis past the lock wins: vertical scroll is not claimed', () => {
    expect(swipeAxis(4, SWIPE.lockPx + 1)).toBe('vertical');
    expect(swipeAxis(SWIPE.lockPx + 1, 4)).toBe('horizontal');
    expect(swipeAxis(20, 21)).toBe('vertical');
    expect(swipeAxis(21, 20)).toBe('horizontal');
  });
});

describe('edge swipe origin', () => {
  it('iOS Safari keeps the browser back-swipe strip; a standalone app uses the real edge', () => {
    expect(edgeSwipeOriginX({ standalone: false, ios: true })).toBe(SWIPE.iosBackZonePx);
    expect(edgeSwipeOriginX({ standalone: true, ios: true })).toBe(0);
    expect(edgeSwipeOriginX({ standalone: false, ios: false })).toBe(0);
  });

  it('a flush conversation panel on iOS Safari starts just inside the back zone', () => {
    expect(isConversationEdgeStart(10, 0, SWIPE.iosBackZonePx)).toBe(false);
    expect(isConversationEdgeStart(24, 0, SWIPE.iosBackZonePx)).toBe(true);
    expect(isConversationEdgeStart(20 + SWIPE.edgeHitPx, 0, SWIPE.iosBackZonePx)).toBe(false);
  });

  it('a tablet panel past the rail uses its own left edge', () => {
    expect(isConversationEdgeStart(72 + 10, 72, SWIPE.iosBackZonePx)).toBe(true);
    expect(isConversationEdgeStart(72 + SWIPE.edgeHitPx + 1, 72, SWIPE.iosBackZonePx)).toBe(false);
    expect(isEdgeSwipeStart(10, 0)).toBe(true);
  });
});

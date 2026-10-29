import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installVisualViewportTracking } from '@/shared/lib/visualViewport';

class FakeVisualViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}

describe('installVisualViewportTracking', () => {
  let viewport: FakeVisualViewport;
  let uninstall: () => void = () => {};
  const root = document.documentElement;
  const settle = () => vi.advanceTimersToNextFrame();

  beforeEach(() => {
    vi.useFakeTimers();
    viewport = new FakeVisualViewport();
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    vi.spyOn(root, 'clientHeight', 'get').mockReturnValue(844);
  });
  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('sizes the app to the visible viewport right away', () => {
    uninstall = installVisualViewportTracking();
    expect(root.style.getPropertyValue('--app-height')).toBe('844px');
    expect(root.style.getPropertyValue('--app-top')).toBe('0px');
    expect(root.dataset.keyboard).toBeUndefined();
  });

  it('follows the keyboard: the app shrinks to what it leaves, and is flagged as open', () => {
    uninstall = installVisualViewportTracking();
    viewport.height = 508;
    viewport.offsetTop = 40;
    viewport.dispatchEvent(new Event('resize'));
    settle();
    expect(root.style.getPropertyValue('--app-height')).toBe('508px');
    expect(root.style.getPropertyValue('--app-top')).toBe('40px');
    expect(root.dataset.keyboard).toBe('open');

    viewport.height = 844;
    viewport.offsetTop = 0;
    viewport.dispatchEvent(new Event('resize'));
    settle();
    expect(root.style.getPropertyValue('--app-height')).toBe('844px');
    expect(root.dataset.keyboard).toBeUndefined();
  });

  it('a browser bar collapsing is not a keyboard', () => {
    uninstall = installVisualViewportTracking();
    viewport.height = 790;
    viewport.dispatchEvent(new Event('resize'));
    settle();
    expect(root.style.getPropertyValue('--app-height')).toBe('790px');
    expect(root.dataset.keyboard).toBeUndefined();
  });

  it('ignores a pinch-zoom, which shrinks the visual viewport too', () => {
    uninstall = installVisualViewportTracking();
    viewport.scale = 2;
    viewport.height = 422;
    viewport.dispatchEvent(new Event('resize'));
    settle();
    expect(root.style.getPropertyValue('--app-height')).toBe('844px');
  });

  it('uninstalling leaves the CSS fallbacks in charge', () => {
    installVisualViewportTracking()();
    expect(root.style.getPropertyValue('--app-height')).toBe('');
    expect(root.style.getPropertyValue('--app-top')).toBe('');
  });
});

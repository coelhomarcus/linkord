import { act } from '@testing-library/react';
import { vi } from 'vitest';

/** An IntersectionObserver the test drives: every element observed starts
 * intersecting (the row is on screen), and `setVisible` moves them all in or
 * out of view, as scrolling would. Undo with vi.unstubAllGlobals(). */
export function controllableIntersection(): { setVisible: (visible: boolean) => void } {
  const observers = new Set<{ callback: IntersectionObserverCallback; targets: Set<Element>; self: IntersectionObserver }>();
  vi.stubGlobal('IntersectionObserver', class {
    private entry: { callback: IntersectionObserverCallback; targets: Set<Element>; self: IntersectionObserver };
    constructor(callback: IntersectionObserverCallback) {
      this.entry = { callback, targets: new Set(), self: this as unknown as IntersectionObserver };
      observers.add(this.entry);
    }
    observe(target: Element) {
      this.entry.targets.add(target);
      this.entry.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this.entry.self);
    }
    unobserve(target: Element) { this.entry.targets.delete(target); }
    disconnect() { observers.delete(this.entry); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
  });
  return {
    setVisible(visible) {
      act(() => {
        for (const { callback, targets, self } of [...observers]) {
          callback([...targets].map((target) => ({ isIntersecting: visible, target }) as IntersectionObserverEntry), self);
        }
      });
    },
  };
}

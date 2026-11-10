import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { initI18n } from '@/shared/i18n/init';

// jsdom reports en-US; the suite asserts the Portuguese UI text.
initI18n('pt-BR');

afterEach(() => {
  if (typeof document === 'undefined') return;
  cleanup();
  // the live region lives on <body>, outside what cleanup unmounts, and outlasts a test
  document.querySelector('[data-live-announcer]')?.replaceChildren();
});

// jsdom has no ClipboardEvent; Lexical's paste handler names it, so a paste
// in the message field threw outside the test and failed the whole run.
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class extends Event {
    clipboardData: DataTransfer | null;
    constructor(type: string, init?: ClipboardEventInit) {
      super(type, init);
      this.clipboardData = init?.clipboardData ?? null;
    }
  };
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof globalThis.IntersectionObserver === 'undefined') {
  // Fires "intersecting" as soon as something is observed — nothing in this
  // app relies on lazy-load-on-scroll actually staying deferred under test,
  // and this keeps every "fetch when it scrolls into view" component
  // exercised by default instead of every test having to fake a scroll.
  globalThis.IntersectionObserver = class {
    callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
    root = null;
    rootMargin = '';
    thresholds: ReadonlyArray<number> = [];
  } as unknown as typeof IntersectionObserver;
}
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = () => {};
}
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
}
if (typeof window !== 'undefined' && typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}
if (typeof Range !== 'undefined' && !Range.prototype.getBoundingClientRect) {
  // jsdom has no layout; the message field (Lexical) measures the caret to keep it in view
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
}

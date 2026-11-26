import type { BrowserContext, Page } from '@playwright/test';

/** Stands in for the desktop app's bridge (`window.overcordDesktop`, desktop/src/preload): the page sees a
 * game running, and the test switches it with `window.__setActivity`. No Electron, the same reporting
 * path as the real app (useActivityReporter). */
export async function fakeDesktop(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    type Found = { key: string; kind: 'playing' | 'using'; name: string; startedAt: number } | null;
    let current: Found = null;
    const listeners = new Set<(activity: Found) => void>();
    const w = window as unknown as { overcordDesktop: unknown; __setActivity: (activity: Found) => void };
    w.__setActivity = (activity) => { current = activity; for (const listener of listeners) listener(activity); };
    w.overcordDesktop = {
      platform: 'win32',
      version: '0.0.0-e2e',
      activity: {
        watch: async () => {},
        current: async () => current,
        recent: async () => [],
        icon: async () => null,
        onChange: (callback: (activity: Found) => void) => { listeners.add(callback); return () => listeners.delete(callback); },
      },
    };
  });
}

export function setDesktopActivity(page: Page, activity: { key: string; name: string; kind: 'playing' | 'using'; startedAt: number } | null) {
  return page.evaluate((value) => (window as unknown as { __setActivity: (next: typeof value) => void }).__setActivity(value), activity);
}

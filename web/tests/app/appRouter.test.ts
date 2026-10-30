import { afterEach, describe, expect, it } from 'vitest';
import { createAppRouter } from '@/app/appRouter';

function visit(url: string) {
  window.history.replaceState(null, '', url);
}

afterEach(() => visit('/'));

describe('createAppRouter', () => {
  it('uses the current URL for a direct visit', () => {
    visit('/app/conversations/c2');
    const router = createAppRouter([{ path: '*', element: null }]);
    expect(router.state.location.pathname).toBe('/app/conversations/c2');
    expect(window.location.pathname).toBe('/app/conversations/c2');
    router.dispose();
  });

  it('writes page navigation to browser history', async () => {
    visit('/app/conversations');
    const router = createAppRouter([{ path: '*', element: null }]);
    await router.navigate('/app/friends');
    expect(window.location.pathname).toBe('/app/friends');
    await router.navigate('/app/conversations/c1');
    expect(window.location.pathname).toBe('/app/conversations/c1');
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/app/friends');
    expect(window.location.pathname).toBe('/app/friends');
    await router.navigate(1);
    expect(router.state.location.pathname).toBe('/app/conversations/c1');
    expect(window.location.pathname).toBe('/app/conversations/c1');
    router.dispose();
  });

  // closing a modal steps back by this index (App.tsx's currentHistoryIndex)
  it('numbers each history entry, so a modal can step back to the page it opened over', async () => {
    visit('/app/profile');
    const router = createAppRouter([{ path: '*', element: null }]);
    const start = (window.history.state as { idx: number }).idx;
    await router.navigate('/app/settings');
    await router.navigate('/app/settings/av');
    expect((window.history.state as { idx: number }).idx).toBe(start + 2);
    await router.navigate(start - (window.history.state as { idx: number }).idx);
    expect(router.state.location.pathname).toBe('/app/profile');
    router.dispose();
  });
});

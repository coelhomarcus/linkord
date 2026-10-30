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
    router.dispose();
  });
});

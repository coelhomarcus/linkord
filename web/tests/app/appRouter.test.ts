import { afterEach, describe, expect, it } from 'vitest';
import { addressFor, createAppRouter } from '@/app/appRouter';

function visit(url: string, state: unknown = null) {
  window.history.replaceState(state, '', url);
}

// the masked navigation the router starts with on a direct visit is async
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => visit('/'));

describe('addressFor', () => {
  it('hides where you are in the app behind the bare app address', () => {
    expect(addressFor('/channels/s1/c1')).toBe('/');
    expect(addressFor('/channels/@me/d1')).toBe('/');
    expect(addressFor('/calls/d1')).toBe('/');
    expect(addressFor('/friends')).toBe('/');
    expect(addressFor('/')).toBe('/');
  });

  it('keeps the pages meant to be linked: settings and invites', () => {
    expect(addressFor('/settings/profile')).toBe('/settings/profile');
    expect(addressFor('/invite/abc')).toBe('/invite/abc');
  });
});

describe('createAppRouter', () => {
  it('opens a direct visit at its real path but shows only the root', async () => {
    visit('/channels/s1/c1');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    expect(router.state.location.pathname).toBe('/channels/s1/c1');
    expect(window.location.pathname).toBe('/');
    router.dispose();
  });

  it('keeps a page per history entry behind the same address, so back and forward still work', async () => {
    visit('/channels/@me');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    await router.navigate('/friends');
    expect(window.location.pathname).toBe('/');
    await router.navigate('/channels/s1/c1');
    expect(router.state.location.pathname).toBe('/channels/s1/c1');
    expect(window.location.pathname).toBe('/');
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/friends');
    expect(window.location.pathname).toBe('/');
    await router.navigate(1);
    expect(router.state.location.pathname).toBe('/channels/s1/c1');
    router.dispose();
  });

  it('reopens the same page after a refresh', async () => {
    visit('/channels/@me');
    const first = createAppRouter([{ path: '*', element: null }]);
    await settle();
    await first.navigate('/channels/s1/c1');
    first.dispose();
    // a reload keeps history.state: a new router reads the real page from it
    const second = createAppRouter([{ path: '*', element: null }]);
    expect(second.state.location.pathname).toBe('/channels/s1/c1');
    expect(window.location.pathname).toBe('/');
    second.dispose();
  });

  it('a query-only navigation stays on the same page and keeps it hidden', async () => {
    visit('/friends');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    await router.navigate('?tab=pending');
    expect(router.state.location.pathname).toBe('/friends');
    expect(router.state.location.search).toBe('?tab=pending');
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('');
    router.dispose();
  });

  it('shows the settings path as it is', async () => {
    visit('/channels/@me');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    await router.navigate('/settings/av');
    expect(window.location.pathname).toBe('/settings/av');
    router.dispose();
  });

  // closing a modal steps back by this index (App.tsx's currentHistoryIndex)
  it('numbers each history entry, so a modal can step back to the page it opened over', async () => {
    visit('/profile');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    const start = (window.history.state as { idx: number }).idx;
    await router.navigate('/settings');
    await router.navigate('/settings/av');
    expect((window.history.state as { idx: number }).idx).toBe(start + 2);
    await router.navigate(start - (window.history.state as { idx: number }).idx);
    expect(router.state.location.pathname).toBe('/profile');
    router.dispose();
  });
});

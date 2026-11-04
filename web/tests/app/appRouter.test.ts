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
    expect(addressFor('/app/channels/s1/c1')).toBe('/app');
    expect(addressFor('/app/channels/@me/d1')).toBe('/app');
    expect(addressFor('/app/calls/d1')).toBe('/app');
    expect(addressFor('/app/friends')).toBe('/app');
    expect(addressFor('/app')).toBe('/app');
  });

  it('keeps the pages meant to be linked: settings, administration, invites', () => {
    expect(addressFor('/app/settings/profile')).toBe('/app/settings/profile');
    expect(addressFor('/admin/users')).toBe('/admin/users');
    expect(addressFor('/invite/abc')).toBe('/invite/abc');
  });
});

describe('createAppRouter', () => {
  it('opens a direct visit at its real path but shows only /app', async () => {
    visit('/app/channels/s1/c1');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    expect(router.state.location.pathname).toBe('/app/channels/s1/c1');
    expect(window.location.pathname).toBe('/app');
    router.dispose();
  });

  it('keeps a page per history entry behind the same address, so back and forward still work', async () => {
    visit('/app/channels/@me');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    await router.navigate('/app/friends');
    expect(window.location.pathname).toBe('/app');
    await router.navigate('/app/channels/s1/c1');
    expect(router.state.location.pathname).toBe('/app/channels/s1/c1');
    expect(window.location.pathname).toBe('/app');
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/app/friends');
    expect(window.location.pathname).toBe('/app');
    await router.navigate(1);
    expect(router.state.location.pathname).toBe('/app/channels/s1/c1');
    router.dispose();
  });

  it('reopens the same page after a refresh', async () => {
    visit('/app/channels/@me');
    const first = createAppRouter([{ path: '*', element: null }]);
    await settle();
    await first.navigate('/app/channels/s1/c1');
    first.dispose();
    // a reload keeps history.state: a new router reads the real page from it
    const second = createAppRouter([{ path: '*', element: null }]);
    expect(second.state.location.pathname).toBe('/app/channels/s1/c1');
    expect(window.location.pathname).toBe('/app');
    second.dispose();
  });

  it('a query-only navigation stays on the same page and keeps it hidden', async () => {
    visit('/app/friends');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    await router.navigate('?tab=pending');
    expect(router.state.location.pathname).toBe('/app/friends');
    expect(router.state.location.search).toBe('?tab=pending');
    expect(window.location.pathname).toBe('/app');
    expect(window.location.search).toBe('');
    router.dispose();
  });

  it('shows the settings path as it is', async () => {
    visit('/app/channels/@me');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    await router.navigate('/app/settings/av');
    expect(window.location.pathname).toBe('/app/settings/av');
    router.dispose();
  });

  // closing a modal steps back by this index (App.tsx's currentHistoryIndex)
  it('numbers each history entry, so a modal can step back to the page it opened over', async () => {
    visit('/app/profile');
    const router = createAppRouter([{ path: '*', element: null }]);
    await settle();
    const start = (window.history.state as { idx: number }).idx;
    await router.navigate('/app/settings');
    await router.navigate('/app/settings/av');
    expect((window.history.state as { idx: number }).idx).toBe(start + 2);
    await router.navigate(start - (window.history.state as { idx: number }).idx);
    expect(router.state.location.pathname).toBe('/app/profile');
    router.dispose();
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { createAppRouter, initialEntry, normalizeBrowserUrl } from '@/app/appRouter';

function visit(url: string) {
  window.history.replaceState(null, '', url);
}

afterEach(() => visit('/'));

describe('initialEntry', () => {
  it('starts at the conversations for the bare address and for unknown paths', () => {
    for (const url of ['/', '/index.html', '/qualquer-coisa', '/application']) {
      visit(url);
      expect(initialEntry(), url).toBe('/app/conversations');
    }
  });

  it('lets an old link still land on the page it names, query included', () => {
    visit('/app/settings/av');
    expect(initialEntry()).toBe('/app/settings/av');
    visit('/app/friends?tab=pending');
    expect(initialEntry()).toBe('/app/friends?tab=pending');
    window.history.replaceState(null, '', '/app/friends?tab=pending#received');
    expect(initialEntry()).toBe('/app/friends?tab=pending#received');
    visit('/admin/users');
    expect(initialEntry()).toBe('/admin/users');
  });
});

describe('normalizeBrowserUrl', () => {
  it('puts the address bar back on the bare address, dropping path, query and hash', () => {
    visit('/app/friends?tab=pending#received');
    normalizeBrowserUrl();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe('/');
  });

  it('leaves the bare address alone', () => {
    visit('/');
    const before = window.history.length;
    normalizeBrowserUrl();
    expect(window.history.length).toBe(before);
  });
});

describe('createAppRouter', () => {
  it('navigates inside the app while the address bar stays put', async () => {
    visit('/app/friends');
    const router = createAppRouter([{ path: '*', element: null }]);
    expect(router.state.location.pathname).toBe('/app/friends');
    expect(window.location.pathname).toBe('/');

    await router.navigate('/app/settings/av');
    await router.navigate('/app/conversations', { state: { conversationId: 'c1' } });
    expect(router.state.location.pathname).toBe('/app/conversations');
    expect(router.state.location.state).toEqual({ conversationId: 'c1' });
    expect(window.location.pathname).toBe('/');
    router.dispose();
  });

  it('keeps its own back stack, so navigating back works without the browser', async () => {
    const router = createAppRouter([{ path: '*', element: null }]);
    await router.navigate('/app/friends');
    await router.navigate('/app/settings');
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/app/friends');
    router.dispose();
  });
});

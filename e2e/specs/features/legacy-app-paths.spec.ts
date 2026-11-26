import { test, expect } from '../../fixtures/test';
import { BASE_URL } from '../../stack/stack';

// The app moved from /app to the root. Links from before (emails already sent,
// pushes, bookmarks, an installed PWA's start URL, older desktop apps) still
// open the same page, query and hash included.

test.describe('links from before the app moved to the root', () => {
  test('the server sends an /app URL to the same page at the root', async ({ users }) => {
    const alice = await users.create('alice');
    const response = await alice.api.get('/app/friends?tab=pending', { maxRedirects: 0 });
    expect(response.status()).toBe(301);
    expect(response.headers().location).toBe('/friends?tab=pending');
    expect((await alice.api.get('/app', { maxRedirects: 0 })).headers().location).toBe('/');
  });

  test('an emailed settings link keeps its section, and a friends link keeps its view', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    expect((await alice.api.post('/api/friend-requests', { data: { username: bob.username } })).ok()).toBe(true);

    const page = await bob.page();
    await page.goto('/app/settings/privacy#data-export');
    await expect(page).toHaveURL(`${BASE_URL}/settings/privacy#data-export`);
    await expect(page.getByRole('button', { name: 'Pedir cópia' })).toBeVisible();

    await page.goto('/app/friends?tab=pending');
    // the request only shows in the pending view, which the query chose
    await expect(page.getByRole('button', { name: 'Aceitar' }).first()).toBeVisible();
    // the app keeps its place out of the address bar, which now shows the root
    await expect(page).toHaveURL(`${BASE_URL}/`);
  });
});

import { test, expect } from '../../fixtures/test';

test.describe('settings', () => {
  test('the language chosen on the account follows it to a new browser', async ({ users }) => {
    const alice = await users.create('alice');
    const page = await alice.page();
    await page.goto('/app/friends');
    await expect(page.getByRole('link', { name: 'Todos', exact: true })).toBeVisible();

    expect((await alice.api.patch('/api/me/locale', { data: { locale: 'en-US' } })).ok()).toBe(true);
    const elsewhere = await users.login(alice.username, alice.password);
    const other = await elsewhere.page();
    await other.goto('/app/friends');
    await expect(other.getByRole('link', { name: 'All', exact: true })).toBeVisible();
  });
});

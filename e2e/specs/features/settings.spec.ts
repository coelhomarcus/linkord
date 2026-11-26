import { test, expect } from '../../fixtures/test';

test.describe('settings', () => {
  test('the language chosen on the account follows it to a new browser', async ({ users }) => {
    const alice = await users.create('alice');
    const page = await alice.page();
    await page.goto('/friends');
    await expect(page.getByRole('link', { name: 'Todos', exact: true })).toBeVisible();

    expect((await alice.api.patch('/api/me/locale', { data: { locale: 'en-US' } })).ok()).toBe(true);
    const elsewhere = await users.login(alice.username, alice.password);
    const other = await elsewhere.page();
    await other.goto('/friends');
    await expect(other.getByRole('link', { name: 'All', exact: true })).toBeVisible();
  });

  test('account settings follow it to another browser at once, device settings stay', async ({ users }) => {
    const alice = await users.create('alice');
    const here = await alice.page();
    await here.goto('/settings/appearance');
    await expect(here.getByRole('radio', { name: 'Tema Black' })).toHaveAttribute('aria-checked', 'true');

    const elsewhere = await users.login(alice.username, alice.password);
    const there = await elsewhere.page();
    await there.goto('/friends');
    await expect(there.getByRole('link', { name: 'Todos', exact: true })).toBeVisible();

    await here.getByRole('radio', { name: 'Tema Catppuccin Mocha' }).click();
    await here.getByText('Maior', { exact: true }).click();
    await expect(here.locator('html')).toHaveAttribute('data-text-size', 'larger');
    await expect(there.locator('html')).toHaveAttribute('data-theme', 'mocha');
    await expect(there.locator('html')).not.toHaveAttribute('data-text-size', 'larger');

    // and a new sign-in starts with it before anything is changed there
    const third = await (await users.login(alice.username, alice.password)).page();
    await third.goto('/friends');
    await expect(third.locator('html')).toHaveAttribute('data-theme', 'mocha');
  });
});

import { expect, test } from '../../fixtures/test';
import { grantAdmin } from '../../stack/stack';

test('the monolith without an admin origin serves the app and closes admin routes', async ({ users }) => {
  const account = await users.create('admin');
  grantAdmin(account.username);
  const admin = await users.login(account.username, account.password);
  expect((await admin.api.get('/api/auth/me')).ok()).toBe(true);
  expect((await admin.api.get('/api/admin/users')).status()).toBe(404);
  expect((await admin.api.get('/admin/users?status=active')).status()).toBe(404);
  const page = await admin.page();
  await page.goto('/app/settings/account');
  await expect(page.getByRole('navigation', { name: 'Categorias de ajustes' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Administração', exact: true })).toHaveCount(0);
});

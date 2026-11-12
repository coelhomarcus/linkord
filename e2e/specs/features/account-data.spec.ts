import { test, expect } from '../../fixtures/test';
import { emailCount } from '../../stack/stack';

// The person's own data (LGPD): downloading a copy from Data & privacy, and deleting the account from
// Account, which a sign-in during the grace period cancels.

test.describe('your data', () => {
  test('a copy of your data is built, emailed and downloaded from Data & privacy', async ({ users }) => {
    const alice = await users.create('export');
    const email = `${alice.username}@example.test`;
    const mailsBefore = await emailCount(email);
    const page = await alice.page();
    await page.goto('/app/settings/privacy#data-export');

    await page.getByRole('button', { name: 'Pedir cópia' }).click();
    // the page looks again every few seconds while the copy is built
    const link = page.getByRole('link', { name: 'Baixar' });
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Você pode pedir outra cópia a partir de/)).toBeVisible();

    const download = page.waitForEvent('download');
    await link.click();
    expect((await download).suggestedFilename()).toBe(`linkord-${alice.username}-${new Date().toISOString().slice(0, 10)}.zip`);
    await expect.poll(() => emailCount(email)).toBeGreaterThan(mailsBefore);
  });

  test('deleting the account signs out, and signing in again cancels it', async ({ users }) => {
    const alice = await users.create('leaving');
    const page = await alice.page();
    await page.goto('/app/settings/account#delete-account');

    await page.getByRole('button', { name: 'Excluir conta', exact: true }).click();
    await page.getByLabel('Senha atual').fill(alice.password);
    await page.getByRole('button', { name: 'Excluir minha conta' }).click();

    await expect(page.getByText(/Sua conta será excluída em .+ Para cancelar, é só entrar de novo antes dessa data\./)).toBeVisible();
    // every session ended, the API included
    expect((await alice.api.get('/api/auth/me')).status()).toBe(401);

    await page.getByLabel('Usuário').fill(alice.username);
    await page.getByLabel('Senha', { exact: true }).fill(alice.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Exclusão da conta cancelada.' })).toBeVisible();
  });
});

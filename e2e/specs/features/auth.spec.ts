import { test, expect } from '../../fixtures/test';
import { BASE_URL } from '../../stack/stack';

test.describe('auth', () => {
  test('a new account lands in the app and keeps its session across a reload', async ({ users }) => {
    const alice = await users.create('alice');
    const page = await alice.page();
    await expect(page.getByText(alice.username).first()).toBeVisible();
    await page.reload();
    await expect(page.getByText(alice.username).first()).toBeVisible();
  });

  test('sign-up without the right invitation code is refused', async ({ playwright }) => {
    const api = await playwright.request.newContext({ baseURL: BASE_URL });
    const response = await api.post('/api/auth/register', {
      data: { username: `nocode${Date.now() % 100000}`, email: 'nocode@example.test', password: 'abcdefgh123', confirmPassword: 'abcdefgh123', code: 'wrong' },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error.code).toBe('invalid_code');
    await api.dispose();
  });

  test('logging in through the form, and a wrong password is refused', async ({ users, browser }) => {
    const alice = await users.create('alice');
    const context = await browser.newContext({ baseURL: BASE_URL, locale: 'pt-BR' });
    const page = await context.newPage();
    await page.goto('/');
    await page.getByRole('tab', { name: 'Entrar' }).click().catch(() => {});

    await page.getByLabel('Usuário').fill(alice.username);
    await page.getByLabel('Senha', { exact: true }).fill('not-the-password');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByText('Usuário ou senha inválidos.')).toBeVisible();

    await page.getByLabel('Senha', { exact: true }).fill(alice.password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page.getByText(alice.username).first()).toBeVisible();
    await context.close();
  });

  test('logging out ends the session', async ({ users }) => {
    const alice = await users.create('alice');
    expect((await alice.api.get('/api/auth/me')).status()).toBe(200);
    expect((await alice.api.post('/api/auth/logout', { data: {} })).ok()).toBe(true);
    expect((await alice.api.get('/api/auth/me')).status()).toBe(401);
  });
});

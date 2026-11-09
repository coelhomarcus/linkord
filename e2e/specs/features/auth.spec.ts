import { test, expect } from '../../fixtures/test';
import { BASE_URL, emailCount, waitForEmailCode } from '../../stack/stack';

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

  test('two-step login: turned on in Settings with the emailed code, then asked for at the next login', async ({ users, browser }) => {
    const alice = await users.create('alice');
    const email = `${alice.username}@example.test`;
    const page = await alice.page();
    await page.goto('/app/settings/security');

    const toggle = page.getByRole('switch', { name: 'Código por e-mail ao entrar' });
    await toggle.click();
    await page.getByLabel('Senha atual').fill(alice.password);
    let seen = await emailCount(email);
    await page.getByRole('button', { name: 'Enviar código' }).click();
    await page.getByLabel('Código de ativação').pressSequentially(await waitForEmailCode(email, seen));
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    const context = await browser.newContext({ baseURL: BASE_URL, locale: 'pt-BR' });
    const other = await context.newPage();
    await other.goto('/');
    await other.getByLabel('Usuário').fill(alice.username);
    await other.getByLabel('Senha', { exact: true }).fill(alice.password);
    seen = await emailCount(email);
    await other.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(other.getByText('Verificação em duas etapas')).toBeVisible();
    const code = await waitForEmailCode(email, seen);
    expect((await context.request.get('/api/auth/me')).status()).toBe(401);

    await other.getByLabel('Código de verificação').pressSequentially(code === '000000' ? '111111' : '000000');
    await expect(other.getByText('Código inválido.')).toBeVisible();
    await other.getByLabel('Código de verificação').pressSequentially(code);
    await expect(other.getByText(alice.username).first()).toBeVisible();
    expect((await context.request.get('/api/auth/me')).status()).toBe(200);
    await context.close();
  });

  test('ending another session from the list signs that browser out on the spot', async ({ users }) => {
    const alice = await users.create('alice');
    const laptop = await alice.page();
    const phone = await users.login(alice.username, alice.password);
    const phonePage = await phone.page();
    await expect(phonePage.getByText(alice.username).first()).toBeVisible();

    await laptop.goto('/app/settings/security');
    const sessions = laptop.getByRole('list', { name: 'Sessões ativas' });
    await expect(sessions.getByRole('listitem')).toHaveCount(2);
    await expect(sessions.getByText('Esta sessão')).toBeVisible();
    await sessions.getByRole('button', { name: /^Encerrar sessão:/ }).click();
    await expect(sessions.getByRole('listitem')).toHaveCount(1);

    // no reload: the server cut the socket and told the tab, which shows the sign-in screen by itself
    await expect(phonePage.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
    expect((await phone.api.get('/api/auth/me')).status()).toBe(401);
    expect((await alice.api.get('/api/auth/me')).status()).toBe(200);
  });
});

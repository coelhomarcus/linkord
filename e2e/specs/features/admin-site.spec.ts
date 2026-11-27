import fs from 'node:fs';
import type { Page } from '@playwright/test';
import { befriend, createServer } from '../../fixtures/api';
import { threeFrameGif } from '../../fixtures/images';
import { expect, test, type User } from '../../fixtures/test';
import { ADMIN_URL, BASE_URL, emailCount, grantAdmin, waitForEmailCode } from '../../stack/stack';

async function signIn(page: Page, user: User) {
  await page.getByLabel('Nome de usuário', { exact: true }).fill(user.username);
  await page.getByLabel('Senha', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
}

test('administration uses its own origin and session', async ({ users, request }) => {
  const admin = await users.create('admin');
  const member = await users.create('member');
  grantAdmin(admin.username);
  const signedIn = await users.login(admin.username, admin.password);
  expect((await signedIn.api.get('/api/admin/users')).status()).toBe(404);
  const appCookie = (await signedIn.context.cookies(BASE_URL)).find((cookie) => cookie.name === 'ss_session');
  expect(appCookie).toBeDefined();
  expect((await request.get(`${ADMIN_URL}/api/admin/users`, {
    headers: { cookie: `overcord_admin=${appCookie!.value}` },
  })).status()).toBe(401);

  const memberPage = await member.context.newPage();
  await memberPage.goto(ADMIN_URL);
  await signIn(memberPage, member);
  await expect(memberPage.getByRole('alert')).toContainText('Você não tem permissão');
  expect((await member.api.get(`${ADMIN_URL}/api/admin/users`)).status()).toBe(401);

  const page = await signedIn.context.newPage();
  for (const legacy of ['/admin', `/admin/users/${member.id}?tab=moderation`]) {
    const retired = await page.goto(BASE_URL + legacy);
    expect(retired?.status()).toBe(404);
    await expect(page).toHaveURL(BASE_URL + legacy);
  }
  await page.goto(`${ADMIN_URL}/admin/users/${member.id}?tab=moderation`);
  await signIn(page, signedIn);
  await expect(page.getByRole('heading', { name: 'Acesso', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
  expect((await page.request.get(`${ADMIN_URL}/api/admin/users`)).ok()).toBe(true);
  expect((await page.request.post(`${ADMIN_URL}/api/admin/users/${member.id}/suspend`, {
    data: { reason: 'origem incorreta' }, headers: { origin: BASE_URL },
  })).status()).toBe(403);
  expect((await page.request.get(`${ADMIN_URL}/api/auth/me`)).status()).toBe(404);
  expect((await page.request.get(`${ADMIN_URL}/sw.js`)).status()).toBe(404);
  await page.getByRole('button', { name: 'Suspender', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Suspender conta' });
  await dialog.getByRole('textbox', { name: 'Motivo (fica registrado na auditoria)', exact: true }).fill('Conta descartável do teste');
  await dialog.getByRole('button', { name: 'Suspender', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reativar conta', exact: true })).toBeVisible();
  expect((await member.api.get('/api/auth/me')).status()).toBe(401);

  await page.setViewportSize({ width: 1440, height: 850 });
  await page.goto(`${ADMIN_URL}/admin/users`);
  const accounts = page.getByRole('table', { name: 'Contas', exact: true });
  await expect(accounts).toBeVisible();
  const tableBox = (await accounts.boundingBox())!;
  expect(tableBox.x + tableBox.width).toBeGreaterThan(1370);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /\/assets\/admin-mark-.+\.svg$/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(accounts).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Buscar usuários' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Papel', exact: true })).toBeVisible();
  await expect(page.getByRole('link').filter({ hasText: `@${member.username}` })).toBeVisible();
  expect(await page.getByRole('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  await page.getByRole('button', { name: 'Sair', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  expect((await page.request.get(`${ADMIN_URL}/api/admin/users`)).status()).toBe(401);
  expect((await signedIn.api.get('/api/auth/me')).ok()).toBe(true);
});

test('a login code is bound to the site that requested it', async ({ users }) => {
  const admin = await users.create('admin');
  grantAdmin(admin.username);
  const email = `${admin.username}@example.test`;
  const activationEmails = await emailCount(email);
  expect((await admin.api.post('/api/auth/two-factor/enable/request', { data: { password: admin.password } })).ok()).toBe(true);
  expect((await admin.api.post('/api/auth/two-factor/enable/confirm', { data: { code: await waitForEmailCode(email, activationEmails) } })).ok()).toBe(true);

  const page = await admin.context.newPage();
  await page.goto(`${ADMIN_URL}/admin/users`);
  const seen = await emailCount(email);
  const login = page.waitForResponse(`${ADMIN_URL}/api/admin/auth/login`);
  await signIn(page, admin);
  const { twoFactor } = await (await login).json() as { twoFactor: { challenge: string } };
  const code = await waitForEmailCode(email, seen);
  const wrongSite = await admin.api.post('/api/auth/login/verify', { data: { challenge: twoFactor.challenge, code } });
  expect(wrongSite.status()).toBe(400);
  await page.getByLabel('Código de verificação', { exact: true }).pressSequentially(code);
  await expect(page.getByRole('button', { name: 'Sair', exact: true })).toBeVisible();
});

test('an admin downloads a full backup of the instance as one ZIP', async ({ users }) => {
  const admin = await users.create('admin');
  const owner = await users.create('owner');
  grantAdmin(admin.username);
  // a stored file the backup must carry
  const server = await createServer(owner.api, 'E2E backup');
  const gif = threeFrameGif();
  const uploaded = await owner.api.post(`/api/servers/${server.id}/emojis?name=e2e_backup`, { headers: { 'Content-Type': gif.mimeType }, data: gif.buffer });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const { emoji } = await uploaded.json() as { emoji: { id: string } };

  const signedIn = await users.login(admin.username, admin.password);
  const page = await signedIn.context.newPage();
  await page.goto(`${ADMIN_URL}/admin/backup`);
  await signIn(page, signedIn);
  await expect(page.getByRole('heading', { name: 'Baixar backup', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Baixar backup', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Baixar backup completo' });
  await dialog.getByRole('textbox', { name: 'Motivo (fica registrado na auditoria)', exact: true }).fill('Cópia antes da atualização');
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Baixar', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^overcord-backup-\d{8}T\d{6}Z\.zip$/);
  expect(await download.failure()).toBeNull();
  await expect(page.getByText(/O download começou no seu navegador/)).toBeVisible();

  // stored entries keep their names and bytes as they are, so the ZIP can be checked without unpacking it
  const zip = fs.readFileSync((await download.path())!);
  expect(zip.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
  const text = zip.toString('latin1');
  for (const entry of ['README.txt', 'database.dump', `uploads/${emoji.id}`, 'manifest.json']) expect(text).toContain(entry);
  expect(text).toContain('"format": 2');

  // the download is on the audit trail with its reason, shown on the page
  await expect(page.getByText('Cópia antes da atualização')).toBeVisible();
  const link = await signedIn.context.request.post(`${ADMIN_URL}/api/admin/backup/download`, { data: { reason: 'sem origem' } });
  expect(link.status()).toBe(403);
});

test('a badge an admin grants shows on the profile and opens with every badge', async ({ users }) => {
  const admin = await users.create('admin');
  const member = await users.create('member');
  const friend = await users.create('friend');
  await befriend(member, friend);
  grantAdmin(admin.username);
  const signedIn = await users.login(admin.username, admin.password);

  const page = await signedIn.context.newPage();
  await page.goto(`${ADMIN_URL}/admin/users/${member.id}?tab=badges`);
  await signIn(page, signedIn);
  await page.getByRole('button', { name: 'Conceder', exact: true }).last().click();
  const dialog = page.getByRole('dialog', { name: 'Conceder insígnia' });
  await dialog.getByRole('textbox', { name: 'Motivo (fica registrado na auditoria)', exact: true }).fill('Apoiou o projeto');
  await dialog.getByRole('button', { name: 'Conceder', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remover', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Insígnias (1)' })).toBeVisible();

  const app = await friend.app();
  await app.page.goto('/friends');
  await app.page.getByRole('button', { name: `Ver perfil de ${member.username}`, exact: true }).click();
  const profile = app.page.getByRole('dialog', { name: `Perfil de ${member.username}` });
  const badges = profile.getByRole('list', { name: 'Insígnias', exact: true });
  await expect(badges.getByRole('button')).toHaveCount(1);
  await badges.getByRole('button', { name: 'Apoiador do Overcord', exact: true }).click();
  const all = app.page.getByRole('dialog', { name: `Insígnias de ${member.username}` });
  await expect(all.getByRole('heading', { name: 'Apoiador do Overcord' })).toBeVisible();
  await expect(all.getByText('Ajudou financeiramente a manter o Overcord no ar.')).toBeVisible();
});

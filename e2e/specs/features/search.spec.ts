import { writeFileSync } from 'node:fs';
import { test, expect, type User } from '../../fixtures/test';
import { acceptInvite, createChannel, createInvite, createServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

// a 1x1 PNG, enough for the image path without a fixture file
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function twoInAChannel(users: { create(prefix?: string): Promise<User> }): Promise<{ bob: User; a: AppPage; b: AppPage; serverId: string; second: string }> {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E search');
  const second = await createChannel(alice.api, server.id, 'segundo');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);
  return { bob, a, b, serverId: server.id, second };
}

const field = (app: AppPage) => app.page.getByRole('combobox', { name: 'Buscar mensagens' });
const results = (app: AppPage) => app.page.getByRole('complementary', { name: 'Buscar mensagens' });

test.describe('header search', () => {
  test('de: picked with the keyboard, then Ir para mensagem', async ({ users }) => {
    const { bob, a, b } = await twoInAChannel(users);
    await b.send('mensagem do bob');
    await a.send('mensagem da alice');
    await a.expectMessage('mensagem do bob');

    await field(a).click();
    await field(a).press('ArrowDown');
    await field(a).press('Space');
    await field(a).fill(bob.username);
    await expect(a.page.getByRole('option', { name: new RegExp(bob.username) })).toBeVisible();
    await field(a).press('ArrowDown');
    await field(a).press('Space');
    await field(a).press('Enter');
    await expect(results(a).getByText('1 resultado')).toBeVisible();
    await expect(results(a).getByText('mensagem do bob')).toBeVisible();
    await expect(results(a).getByText('mensagem da alice')).toHaveCount(0);

    await results(a).getByText('mensagem do bob').hover();
    await results(a).getByRole('button', { name: 'Ir para mensagem' }).click();
    await a.expectMessage('mensagem do bob');

    // kept as a recent search
    await field(a).click();
    await field(a).press('Escape');
    await field(a).click();
    await expect(a.page.getByRole('option', { name: new RegExp(`de:\\s*${bob.username}`) })).toBeVisible();
  });

  test('tem: imagem finds an uploaded picture and nothing else', async ({ users }, testInfo) => {
    const { a, b } = await twoInAChannel(users);
    const file = testInfo.outputPath('pixel.png');
    writeFileSync(file, PNG);
    await b.page.locator('input[type=file]:not([accept])').setInputFiles(file);
    await b.send('olha a foto');
    await b.send('só texto');
    await a.expectMessage('só texto');

    await field(a).fill('tem:');
    await a.page.getByRole('option', { name: 'imagem' }).click();
    await a.page.getByRole('option', { name: /De um usuário específico/ }).hover();
    await field(a).press('ArrowDown');
    await field(a).press('Enter');
    await expect(results(a).getByText('1 resultado')).toBeVisible();
    await expect(results(a).getByText('olha a foto')).toBeVisible();
  });

  test('Filtros narrows to a channel, and Ordenar puts the oldest first', async ({ users }) => {
    const { a, b, serverId, second } = await twoInAChannel(users);
    await b.send('relatório um');
    await b.send('relatório dois');
    await b.openChannel(serverId, second);
    await b.send('relatório no segundo');

    await field(a).fill('relatório');
    await field(a).press('Enter');
    await expect(results(a).getByText('3 resultados')).toBeVisible();

    await results(a).getByRole('button', { name: 'Filtros' }).click();
    const dialog = a.page.getByRole('dialog', { name: 'Filtros' });
    await dialog.getByRole('button', { name: 'Em' }).click();
    const selected = a.page.getByRole('option', { name: 'segundo' });
    await selected.press('Space');
    await expect(selected).toHaveAttribute('aria-selected', 'true');
    await a.page.getByRole('option', { name: 'geral', exact: true }).press('Enter');
    await expect(dialog).toBeHidden();
    await expect(results(a).getByText('1 resultado')).toBeVisible();
    await expect(results(a).getByText('relatório no segundo')).toBeVisible();

    await a.page.getByRole('button', { name: 'Limpar busca' }).click();
    await field(a).fill('relatório');
    await field(a).press('Enter');
    await results(a).getByRole('button', { name: 'Ordenar' }).click();
    await a.page.getByRole('menuitemradio', { name: 'Mais antigos' }).click();
    await expect(results(a).locator('article').first()).toContainText('relatório um');
  });
});

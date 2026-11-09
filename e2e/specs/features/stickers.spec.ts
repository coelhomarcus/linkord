import { test, expect } from '../../fixtures/test';
import { befriend, createServer } from '../../fixtures/api';
import { threeFrameGif } from '../../fixtures/images';

test('an admin uploads a sticker from the server settings, with its emoji, name and description', async ({ users }) => {
  const alice = await users.create('alice');
  const server = await createServer(alice.api, 'E2E sticker upload');
  const a = await alice.app();
  await a.openChannel(server.id, server.text.id);

  // the header's menu button, not the rail icon of the same name
  await a.page.getByRole('button', { name: 'E2E sticker upload', exact: true, expanded: false }).click();
  await a.page.getByRole('menuitem', { name: 'Configurações do servidor' }).click();
  const settings = a.page.getByRole('dialog', { name: 'Configurações de E2E sticker upload' });
  await settings.getByRole('button', { name: 'Figurinhas', exact: true }).click();
  // the panel's own button, not the composer's behind the settings
  await settings.getByRole('button', { name: 'Enviar figurinha' }).first().click();

  const dialog = a.page.getByRole('dialog', { name: 'Enviar figurinha' });
  await dialog.locator('input[type=file]').setInputFiles(threeFrameGif());
  await dialog.getByRole('button', { name: 'Emoji relacionado' }).click();
  await a.page.getByRole('grid', { name: 'Emojis' }).getByRole('gridcell').first().click();
  await expect(dialog.getByRole('button', { name: /^Emoji relacionado: / })).toBeVisible();
  await dialog.getByRole('textbox', { name: /Nome da figurinha/ }).fill('Três cores');
  await dialog.getByRole('textbox', { name: 'Descrição' }).fill('Quadrado branco piscando');
  await dialog.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await expect(settings.getByRole('listitem').filter({ hasText: 'Três cores' }).getByRole('img', { name: 'Quadrado branco piscando' })).toBeVisible();
  await expect(settings.getByText('29 espaços livres de 30')).toBeVisible();
});

test('a sticker goes into a DM with someone outside its server, who sees it and can reply, until it is deleted', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E stickers');
  const uploaded = await alice.api.post(`/api/servers/${server.id}/stickers?${new URLSearchParams({ name: 'cores', emoji: '🎨', description: 'Três cores' })}`, {
    headers: { 'Content-Type': 'image/gif' }, data: threeFrameGif().buffer,
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const { sticker } = await uploaded.json() as { sticker: { id: string; animated: boolean } };
  expect(sticker.animated).toBe(true);

  // bob is not in alice's server
  await befriend(alice, bob);
  const a = await alice.app();
  const b = await bob.app();
  const dm = await a.openDmWith(bob.username);

  // the composer keeps what is typed: the sticker is a message of its own
  await a.composer().fill('rascunho');
  await a.page.getByRole('button', { name: 'Enviar figurinha' }).click();
  await a.page.getByRole('gridcell', { name: 'cores' }).first().click();
  await expect(a.composer()).toHaveValue('rascunho');
  await expect(a.page.locator('[data-message-id]').getByRole('img', { name: 'Três cores' })).toBeVisible();

  await b.openDm(dm);
  const picture = b.page.locator('[data-message-id]').getByRole('img', { name: 'Três cores' });
  await expect(picture).toBeVisible();
  await expect(picture).toHaveAttribute('src', `/api/stickers/${sticker.id}`);
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(320);
  await b.page.getByRole('button', { name: 'Figurinha cores' }).click();
  await expect(b.page.getByText('De um servidor em que você não está')).toBeVisible();
  await b.page.keyboard.press('Escape');

  // bob has no stickers of his own to send
  await b.page.getByRole('button', { name: 'Enviar figurinha' }).click();
  await expect(b.page.getByText(/Nenhuma figurinha ainda/)).toBeVisible();
  await b.page.keyboard.press('Escape');

  // a reply quotes it by name
  const row = b.page.locator('[data-message-id]').filter({ has: b.page.getByRole('img', { name: 'Três cores' }) });
  await row.hover();
  await row.getByRole('button', { name: 'Responder' }).click();
  await b.send('que lindo');
  await expect(a.message('que lindo')).toContainText('Figurinha: cores');

  // deleted, old messages read as unavailable
  const removed = await alice.api.delete(`/api/servers/${server.id}/stickers/${sticker.id}`);
  expect(removed.status()).toBe(204);
  await b.page.reload();
  await expect(b.page.locator('[data-message-id]').getByText('Figurinha indisponível')).toBeVisible();
});

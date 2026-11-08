import { test, expect } from '../../fixtures/test';
import { befriend } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

/** Opens the user panel's card; the status row in it opens the four statuses. */
async function openCard(app: AppPage) {
  await app.page.getByRole('button', { name: 'Status e perfil' }).click();
  return app.page.getByRole('dialog', { name: 'Status e perfil' });
}

async function pickStatus(app: AppPage, name: RegExp): Promise<void> {
  const card = await openCard(app);
  await card.getByRole('button', { name: /^Status: / }).click();
  await app.page.getByRole('menuitemradio', { name }).click();
  await app.page.keyboard.press('Escape');
  await expect(card).toBeHidden();
}

test.describe('presence status', () => {
  test('a status set on one device reaches the other device and a friend, live', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const desktop = await alice.app();
    const phone = await (await users.login(alice.username, alice.password)).app();
    const b = await bob.app();
    await b.openDmWith(alice.username);
    // Bob's DM list row for Alice: her dot and, under her name, her custom status
    const row = b.page.locator(`li[data-user-id="${alice.id}"]`);
    const dot = row.locator('[data-status]');
    await expect(dot).toHaveAttribute('data-status', 'online');

    await pickStatus(desktop, /^Não perturbe/);
    await expect(dot).toHaveAttribute('data-status', 'dnd');
    await expect(phone.page.getByRole('button', { name: 'Status e perfil' }).getByRole('img', { name: 'Não perturbe' })).toBeVisible();

    // the custom status lives in the bubble beside the card's avatar
    await (await openCard(phone)).getByRole('button', { name: 'Definir status personalizado' }).click();
    await phone.page.getByLabel('Texto').fill('testando a presença');
    await phone.page.getByRole('button', { name: 'Salvar' }).click();
    await expect(row).toContainText('testando a presença');
    await expect(desktop.page.getByRole('button', { name: 'Status e perfil' })).toContainText('testando a presença');

    // invisible reads as offline, custom status included
    await pickStatus(desktop, /^Invisível/);
    await expect(dot).toHaveAttribute('data-status', 'offline');
    await expect(row).not.toContainText('testando a presença');
    await b.page.goto('/app/friends');
    await b.page.getByRole('link', { name: 'Online' }).click();
    await expect(b.page.getByRole('button', { name: `Enviar mensagem para ${alice.username}` })).toHaveCount(0);

    await pickStatus(phone, /^Disponível/);
    await b.openDmWith(alice.username);
    await expect(dot).toHaveAttribute('data-status', 'online');
    await expect(row).toContainText('testando a presença');
  });

  test('the status is saved on the account', async ({ users }) => {
    const alice = await users.create('alice');
    const a = await alice.app();
    await pickStatus(a, /^Ausente/);
    await expect(a.page.getByRole('button', { name: 'Status e perfil' }).getByRole('img', { name: 'Ausente' })).toBeVisible();

    await a.page.reload();
    await expect(a.page.getByRole('button', { name: 'Status e perfil' }).getByRole('img', { name: 'Ausente' })).toBeVisible();
  });
});

import { test, expect } from '../../fixtures/test';
import { befriend } from '../../fixtures/api';

test.describe('direct messages', () => {
  test('friends talk in a DM; a message read elsewhere shows as unread until opened', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const a = await alice.app();
    const b = await bob.app();

    const dm = await a.openDmWith(bob.username);
    await a.send('primeira mensagem na DM');

    // Bob is on the friends page, not in the DM: the DM shows up with an unread count
    await b.page.goto('/app/friends');
    await expect(b.page.getByLabel(`${alice.username}, 1 não lidas`)).toBeVisible();

    await b.openDm(dm);
    await b.expectMessage('primeira mensagem na DM');
    await b.send('resposta na DM');
    await a.expectMessage('resposta na DM');
  });

  test('muting a DM drops its unread count in every tab of the account, and the header unmutes it', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const a = await alice.app();
    const dm = await a.openDmWith(bob.username);
    await a.send('primeira');

    const b = await bob.app();
    await b.page.goto('/app/friends');
    const other = await bob.newTab('/app/friends');
    const row = (tab: typeof b) => tab.page.locator(`li[data-conversation-id="${dm}"] > button`).first();
    await expect(row(b)).toHaveAttribute('aria-label', `${alice.username}, 1 não lidas`);

    await row(b).click({ button: 'right' });
    await b.page.getByRole('menuitem', { name: 'Silenciar conversa' }).hover();
    await b.page.getByRole('menuitem', { name: 'Por 1 hora' }).click();
    // live in the other tab too, without a reload
    for (const tab of [b, other]) await expect(row(tab)).toHaveAttribute('aria-label', `${alice.username}, Silenciado`);

    const arrived = other.waitForSocketEvent('chat');
    await a.send('segunda');
    await arrived;
    await expect(row(other)).toHaveAttribute('aria-label', `${alice.username}, Silenciado`);

    await b.openDm(dm);
    await b.page.getByRole('button', { name: 'Configurações de notificação' }).click();
    await b.page.getByRole('menuitem', { name: /^Reativar conversa/ }).click();
    await expect(row(other)).toHaveAttribute('aria-label', alice.username);
  });

  test('someone who is not a friend cannot start a DM', async ({ users }) => {
    const alice = await users.create('alice');
    const stranger = await users.create('strange');
    const page = await stranger.page();
    await page.goto('/app/friends');
    await expect(page.getByRole('button', { name: `Enviar mensagem para ${alice.username}` })).toHaveCount(0);
  });
});

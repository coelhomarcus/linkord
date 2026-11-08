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

  test('someone who is not a friend cannot start a DM', async ({ users }) => {
    const alice = await users.create('alice');
    const stranger = await users.create('strange');
    const page = await stranger.page();
    await page.goto('/app/friends');
    await expect(page.getByRole('button', { name: `Enviar mensagem para ${alice.username}` })).toHaveCount(0);
  });
});

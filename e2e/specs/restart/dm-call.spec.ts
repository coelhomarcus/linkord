import { test, expect } from '../../fixtures/test';
import { befriend } from '../../fixtures/api';
import { deploy } from '../../stack/stack';

test.describe('a DM call across a redeploy', () => {
  test('an answered call keeps both sides connected', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const a = await alice.app();
    const b = await bob.app();
    await a.openDmWith(bob.username);
    await b.openDmWith(alice.username);

    await a.page.getByRole('button', { name: 'Ligar', exact: true }).first().click();
    await b.page.getByRole('button', { name: 'Atender' }).click();
    await a.expectTilesFor([alice.username, bob.username]);
    await a.expectRemoteAudio(1);
    await b.expectRemoteAudio(1);

    await deploy();

    await a.expectTilesFor([alice.username, bob.username]);
    await b.expectTilesFor([alice.username, bob.username]);
    await a.expectRemoteAudio(1);
    await b.expectRemoteAudio(1);
    await expect(a.page.getByText('Chamada encerrada')).toHaveCount(0);
  });

  test('a ring in progress can still be answered after the redeploy', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const a = await alice.app();
    const b = await bob.app();
    await a.openDmWith(bob.username);
    await b.openDmWith(alice.username);

    await a.page.getByRole('button', { name: 'Ligar', exact: true }).first().click();
    await expect(b.page.getByRole('button', { name: 'Atender' })).toBeVisible();

    // Answering is a socket message: a click while the tab is still reconnecting
    // is dropped (the card stays, nothing tells the user). Answer once it is back.
    const bobBack = b.waitForSocketEvent('welcome', 60_000);
    await deploy();
    await bobBack;

    await b.page.getByRole('button', { name: 'Atender' }).click();
    await a.expectTilesFor([alice.username, bob.username]);
    await b.expectTilesFor([alice.username, bob.username]);
    await a.expectRemoteAudio(1);
    await b.expectRemoteAudio(1);
  });
});

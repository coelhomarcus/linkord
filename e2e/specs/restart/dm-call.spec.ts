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
    await expect(a.page.getByRole('dialog')).toHaveCount(0);
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

    // Answer while Bob's tab is still disconnected: the answer has to wait for
    // the reconnect and go out then (useDmCall's unsent answer), not vanish.
    const disconnectsBefore = b.socketDisconnects.length;
    const deploying = deploy();
    await expect.poll(() => b.socketDisconnects.length, { timeout: 30_000 }).toBeGreaterThan(disconnectsBefore);
    await b.page.getByRole('button', { name: 'Atender' }).click();
    await deploying;

    await a.expectTilesFor([alice.username, bob.username]);
    await b.expectTilesFor([alice.username, bob.username]);
    await a.expectRemoteAudio(1);
    await b.expectRemoteAudio(1);
  });
});

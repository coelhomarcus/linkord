import { test, expect, type User } from '../../fixtures/test';
import { befriend } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

async function friendsInTheirDm(users: { create(prefix?: string): Promise<User> }): Promise<{ alice: User; bob: User; a: AppPage; b: AppPage }> {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  await befriend(alice, bob);
  const a = await alice.app();
  const b = await bob.app();
  await a.openDmWith(bob.username);
  await b.openDmWith(alice.username);
  return { alice, bob, a, b };
}

const call = (app: AppPage, video = false) => app.page.getByRole('button', { name: video ? 'Ligar com vídeo' : 'Ligar', exact: true }).first().click();

test.describe('DM calls', () => {
  test('declining a ring tells the caller, and no call starts', async ({ users }) => {
    const { a, b } = await friendsInTheirDm(users);
    await call(a);
    await b.page.getByRole('button', { name: 'Recusar' }).click();
    await expect(a.page.getByText('Chamada recusada')).toBeVisible();
    await expect(a.tiles()).toHaveCount(0);
  });

  test('cancelling a ring takes it away from the callee', async ({ users }) => {
    const { a, b } = await friendsInTheirDm(users);
    await call(a);
    await expect(b.page.getByRole('button', { name: 'Atender' })).toBeVisible();
    await a.page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(b.page.getByRole('button', { name: 'Atender' })).toHaveCount(0);
  });

  test('an answered voice call carries audio both ways and leaves a line in the chat when it ends', async ({ users }) => {
    const { alice, bob, a, b } = await friendsInTheirDm(users);
    await call(a);
    await b.page.getByRole('button', { name: 'Atender' }).click();
    await a.expectTilesFor([alice.username, bob.username]);
    await b.expectTilesFor([alice.username, bob.username]);
    await a.expectRemoteAudio(1);
    await b.expectRemoteAudio(1);

    await b.page.getByRole('button', { name: 'Sair da chamada' }).first().click();
    await expect(a.tiles()).toHaveCount(0);
    await expect(a.page.getByText(/Você iniciou uma chamada/)).toBeVisible();
    await expect(b.page.getByText(new RegExp(`${alice.username} iniciou uma chamada`))).toBeVisible();
  });

  test('a video call starts with the caller\'s camera on', async ({ users }) => {
    const { alice, a, b } = await friendsInTheirDm(users);
    await call(a, true);
    await b.page.getByRole('button', { name: 'Atender' }).click();
    await expect(b.page.locator('[data-tile-kind="camera"]').filter({ hasText: alice.username })).toBeVisible();
  });
});

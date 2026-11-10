import { test, expect, type User } from '../../fixtures/test';
import { acceptInvite, createChannel, createInvite, createServer, type CreatedServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

async function twoInVoice(users: { create(prefix?: string): Promise<User> }): Promise<{ alice: User; bob: User; a: AppPage; b: AppPage; server: CreatedServer }> {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E voice');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);
  await a.joinVoice(server.voice.name);
  await b.joinVoice(server.voice.name);
  return { alice, bob, a, b, server };
}

test.describe('voice channels', () => {
  test('two people in a voice channel see and hear each other', async ({ users }) => {
    const { alice, bob, a, b } = await twoInVoice(users);
    await a.expectTilesFor([alice.username, bob.username]);
    await b.expectTilesFor([alice.username, bob.username]);
    await a.expectRemoteAudio(1);
    await b.expectRemoteAudio(1);
  });

  test('muting shows on the other side, and the camera becomes a video tile', async ({ users }) => {
    const { bob, a, b } = await twoInVoice(users);
    await b.page.getByRole('button', { name: 'Mutar' }).first().click();
    await expect(a.page.getByLabel('Microfone desativado').first()).toBeVisible();

    await b.page.getByRole('button', { name: 'Ligar câmera' }).first().click();
    await expect(a.page.locator('[data-tile-kind="camera"]').filter({ hasText: bob.username })).toBeVisible();
    await b.page.getByRole('button', { name: 'Parar câmera' }).first().click();
    await expect(a.page.locator('[data-tile-kind="camera"]')).toHaveCount(0);
  });

  test('sharing the screen shows the share to the other member until it stops', async ({ users }) => {
    const { bob, a, b } = await twoInVoice(users);
    // Sharing is refused until the tab reaches LiveKit; hearing the other side proves it has.
    await b.expectRemoteAudio(1);
    // The fake media UI accepts the picker with a fake screen, like a person choosing one.
    await b.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
    await expect(a.page.locator('[data-tile-kind="screen"]').filter({ hasText: bob.username })).toBeVisible();
    await b.page.getByRole('button', { name: 'Parar compartilhamento' }).first().click();
    await expect(a.page.locator('[data-tile-kind="screen"]')).toHaveCount(0);
  });

  test('leaving the call removes the tile for the other member', async ({ users }) => {
    const { bob, a, b } = await twoInVoice(users);
    await a.expectTilesFor([bob.username]);
    await b.page.getByRole('button', { name: 'Sair da chamada' }).first().click();
    await expect(a.participant(bob.username)).toHaveCount(0);
    await a.expectRemoteAudio(0);
  });

  test('the owner moves a member to another voice channel, then disconnects them', async ({ users }) => {
    const { alice, bob, a, b, server } = await twoInVoice(users);
    await createChannel(alice.api, server.id, 'Outra sala', 'voice');
    const rosterEntry = () => a.page.getByRole('navigation').getByText(bob.username, { exact: true }).first();

    // moderation goes through the voice roster's menu in the sidebar, like a moderator would
    await rosterEntry().click({ button: 'right' });
    await a.page.getByRole('menuitem', { name: 'Outra sala' }).click();
    await expect(a.participant(bob.username)).toHaveCount(0);
    await expect(b.page.getByText('Em chamada')).toBeVisible();
    await b.expectTilesFor([bob.username]);

    await rosterEntry().click({ button: 'right' });
    await a.page.getByRole('menuitem', { name: 'Desconectar' }).click();
    await expect(b.page.getByText('Em chamada')).toHaveCount(0);
  });
});

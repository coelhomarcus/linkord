import { test, expect, type User } from '../../fixtures/test';
import { acceptInvite, befriend, createInvite, createServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

// One account, two tabs of the same browser: the server keeps the account in one call at a time.

const MOVE_DIALOG = 'Trazer a chamada para esta aba?';

function moveDialog(app: AppPage) {
  return app.page.getByRole('dialog', { name: MOVE_DIALOG });
}

async function confirmMove(app: AppPage): Promise<void> {
  await moveDialog(app).getByRole('button', { name: 'Entrar por aqui' }).click();
  await expect(moveDialog(app)).toHaveCount(0);
}

const callDm = (app: AppPage) => app.page.getByRole('button', { name: 'Ligar', exact: true }).first().click();

/** The account's second tab, opened on a page that shows the composer. */
async function secondTab(user: User, path: string): Promise<AppPage> {
  const tab = await user.newTab(path);
  await expect(tab.composer()).toBeVisible();
  return tab;
}

test.describe('one call per account across tabs', () => {
  test('a voice call in one tab shows in another, and moves there only after asking', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E one call');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const first = await alice.app();
    const b = await bob.app();
    await first.openChannel(server.id, server.text.id);
    await b.openChannel(server.id, server.text.id);
    await first.joinVoice(server.voice.name);
    await b.joinVoice(server.voice.name);
    await b.expectRemoteAudio(1);

    // opened after the call started: its first snapshot has to carry the other tab's call
    const second = await secondTab(alice, `/app/channels/${server.id}/${server.text.id}`);
    const members = second.page.getByRole('list', { name: `Na chamada de ${server.voice.name}` });
    await expect(members.getByText(alice.username)).toBeVisible();
    await expect(second.page.getByText('Canal de voz em outra aba ou dispositivo')).toBeVisible();
    await expect(second.page.getByText('Em chamada')).toHaveCount(0);

    // keeping the call where it is
    await second.page.getByRole('button', { name: server.voice.name, exact: true }).click();
    await expect(moveDialog(second)).toBeVisible();
    await moveDialog(second).getByRole('button', { name: 'Cancelar' }).click();
    await expect(moveDialog(second)).toHaveCount(0);
    await expect(first.page.getByText('Em chamada')).toBeVisible();
    await expect(second.page.getByText('Em chamada')).toHaveCount(0);

    // moving it
    await second.page.getByRole('button', { name: server.voice.name, exact: true }).click();
    await confirmMove(second);
    await expect(second.page.getByText('Em chamada')).toBeVisible();
    await second.expectRemoteAudio(1);
    await expect(first.page.getByText('Em chamada')).toHaveCount(0);
    await expect(first.page.getByText('Canal de voz em outra aba ou dispositivo')).toBeVisible();
    await first.expectRemoteAudio(0);
    await expect(first.tiles()).toHaveCount(0);

    // Bob still has Alice in the call, once
    await b.expectRemoteAudio(1);
    await expect(b.participant(alice.username)).toHaveCount(1);
    await expect(b.page.getByRole('list', { name: `Na chamada de ${server.voice.name}` }).getByText(alice.username)).toHaveCount(1);
  });

  test('a DM call moves to another tab of the account, and the other person stays in it', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const first = await alice.app();
    const b = await bob.app();
    const dmId = await first.openDmWith(bob.username);
    await b.openDmWith(alice.username);
    await callDm(first);
    await b.page.getByRole('button', { name: 'Atender' }).click();
    await first.expectRemoteAudio(1);

    const second = await secondTab(alice, `/app/channels/@me/${encodeURIComponent(dmId)}`);
    await expect(second.page.getByText('Chamada privada em outra aba ou dispositivo')).toBeVisible();

    await callDm(second);
    await confirmMove(second);
    await second.expectTilesFor([alice.username, bob.username]);
    await second.expectRemoteAudio(1);
    await expect(first.tiles()).toHaveCount(0);
    await first.expectRemoteAudio(0);
    await expect(first.page.getByText('Chamada privada em outra aba ou dispositivo')).toBeVisible();

    // the call itself never ended: Bob is in it with the tab that took it
    await b.expectTilesFor([alice.username, bob.username]);
    await b.expectRemoteAudio(1);
    await expect(b.page.getByText(/iniciou uma chamada/)).toHaveCount(0);
  });

  test('answering a ring in one tab while another is in a voice channel asks first, then leaves the channel', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const server = await createServer(alice.api, 'E2E ring elsewhere');
    const first = await alice.app();
    await first.openChannel(server.id, server.text.id);
    await first.joinVoice(server.voice.name);
    const second = await secondTab(alice, `/app/channels/${server.id}/${server.text.id}`);
    await expect(second.page.getByText('Canal de voz em outra aba ou dispositivo')).toBeVisible();

    const b = await bob.app();
    await b.openDmWith(alice.username);
    await callDm(b);
    await second.page.getByRole('button', { name: 'Atender' }).click();
    await expect(moveDialog(second)).toBeVisible();
    await confirmMove(second);

    await second.expectTilesFor([alice.username, bob.username]);
    await second.expectRemoteAudio(1);
    await b.expectRemoteAudio(1);
    await expect(first.page.getByText('Chamada privada em outra aba ou dispositivo')).toBeVisible();
    await expect(first.page.getByRole('list', { name: `Na chamada de ${server.voice.name}` })).toHaveCount(0);
  });
});

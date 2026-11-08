import { test, expect } from '../../fixtures/test';
import { PERMISSIONS, acceptInvite, createChannel, createInvite, createServer, setChannelOverwrite } from '../../fixtures/api';

test.describe('servers', () => {
  test('creating a server from the rail lands in its #geral', async ({ users }) => {
    const alice = await users.create('alice');
    const a = await alice.app();
    await a.page.getByRole('button', { name: 'Adicionar um servidor' }).click();
    await a.page.getByRole('button', { name: 'Criar o meu' }).click();
    await a.page.getByLabel('Nome do servidor').fill('Servidor E2E');
    await a.page.getByRole('button', { name: 'Criar', exact: true }).click();
    await expect(a.composer()).toBeVisible();
    await expect(a.page.getByPlaceholder('Conversar em #geral')).toBeVisible();
  });

  test('an invite link brings a member in, who appears to the owner', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E invite');
    const code = await createInvite(alice.api, server.id);
    const a = await alice.app();
    await a.openChannel(server.id, server.text.id);

    const b = await bob.app();
    await b.page.goto(`/invite/${code}`);
    await b.page.getByRole('button', { name: /^Entrar/ }).first().click();
    await expect(b.page.getByPlaceholder('Conversar em #geral')).toBeVisible();
    await expect(a.page.getByText(bob.username).first()).toBeVisible();
  });

  test('a new channel shows up for members, and one hidden from @everyone does not', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E channels');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const b = await bob.app();
    await b.openChannel(server.id, server.text.id);

    await createChannel(alice.api, server.id, 'avisos');
    await expect(b.page.getByRole('button', { name: 'avisos', exact: true })).toBeVisible();

    const secret = await createChannel(alice.api, server.id, 'segredo');
    await setChannelOverwrite(alice.api, server.id, secret, server.everyoneRoleId, 0, PERMISSIONS.VIEW_CHANNEL);
    await b.page.reload();
    await expect(b.page.getByRole('button', { name: 'avisos', exact: true })).toBeVisible();
    await expect(b.page.getByRole('button', { name: 'segredo', exact: true })).toHaveCount(0);
    const read = await bob.api.post(`/api/servers/${server.id}/channels`, { data: { name: 'tentativa' } });
    expect(read.status()).toBe(403);
  });

  test('a channel where @everyone cannot post shows no composer to a member', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E read only');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const readOnly = await createChannel(alice.api, server.id, 'so-leitura');
    await setChannelOverwrite(alice.api, server.id, readOnly, server.everyoneRoleId, 0, PERMISSIONS.SEND_MESSAGES);

    const a = await alice.app();
    await a.openChannel(server.id, readOnly);
    await a.send('só a dona escreve aqui');
    const b = await bob.app();
    await b.page.goto(`/app/channels/${server.id}/${readOnly}`);
    await b.expectMessage('só a dona escreve aqui');
    await expect(b.composer()).toHaveCount(0);
  });

  test('kick, ban and unban decide whether the invite works again', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E moderation');
    const code = await createInvite(alice.api, server.id);
    await acceptInvite(bob.api, code);
    const b = await bob.app();
    await b.openChannel(server.id, server.text.id);

    expect((await alice.api.delete(`/api/servers/${server.id}/members/${bob.id}`)).ok()).toBe(true);
    await expect(b.page.getByPlaceholder('Conversar em #geral')).toHaveCount(0);
    await acceptInvite(bob.api, code); // a kick is not a ban

    expect((await alice.api.put(`/api/servers/${server.id}/bans/${bob.id}`, { data: {} })).ok()).toBe(true);
    expect((await bob.api.post(`/api/invites/${code}/accept`, { data: {} })).ok()).toBe(false);

    expect((await alice.api.delete(`/api/servers/${server.id}/bans/${bob.id}`)).ok()).toBe(true);
    await acceptInvite(bob.api, code);
  });

  test('deleting the server takes it away from its members at once', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E delete');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const b = await bob.app();
    await b.openChannel(server.id, server.text.id);

    expect((await alice.api.delete(`/api/servers/${server.id}`)).ok()).toBe(true);
    await expect(b.page.getByPlaceholder('Conversar em #geral')).toHaveCount(0);
    expect((await bob.api.get(`/api/servers/${server.id}/members`)).ok()).toBe(false);
  });
});

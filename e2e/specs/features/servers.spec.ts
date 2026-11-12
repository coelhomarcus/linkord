import { test, expect } from '../../fixtures/test';
import { PERMISSIONS, acceptInvite, createChannel, createInvite, createServer, setChannelOverwrite } from '../../fixtures/api';
import { gifInfo, threeFrameGif } from '../../fixtures/images';

test.describe('servers', () => {
  test('a muted server stays quiet in the rail but still counts a mention; its settings follow the account', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E mute');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const a = await alice.app();
    await a.openChannel(server.id, server.text.id);
    const b = await bob.app();
    await b.openChannel(server.id, server.text.id);

    await b.page.getByRole('button', { name: server.name, exact: true, expanded: false }).click();
    await b.page.getByRole('menuitem', { name: 'Silenciar servidor' }).hover();
    await b.page.getByRole('menuitem', { name: 'Até eu reativar' }).click();
    // the menu plays its exit before it leaves the page
    await expect(b.page.getByRole('menu')).toHaveCount(0);
    await expect(b.page.locator(`[data-channel-id="${server.text.id}"]`).getByRole('img', { name: 'Silenciado' })).toBeVisible();

    // the channel picks its own level from the bell in its header, over the server's default
    await b.page.getByRole('button', { name: 'Configurações de notificação' }).click();
    await expect(b.page.getByRole('menuitem', { name: 'O servidor está silenciado' })).toBeVisible();
    await b.page.getByRole('menuitem', { name: 'Notificações' }).hover();
    await expect(b.page.getByRole('menuitemradio', { name: 'Padrão do servidor (Todas as mensagens)' })).toHaveAttribute('aria-checked', 'true');
    await b.page.getByRole('menuitemradio', { name: 'Somente @menções' }).click();
    await expect(b.page.getByRole('menuitemradio', { name: 'Somente @menções' })).toHaveAttribute('aria-checked', 'true');

    // away from the channel, plain traffic leaves no badge on the muted server's icon...
    await b.page.goto('/app/friends');
    const rail = b.page.getByRole('navigation', { name: 'Servidores' });
    const plain = b.waitForSocketEvent('chat');
    await a.send('mensagem comum');
    await plain;
    await expect(rail.getByRole('button', { name: server.name, exact: true })).toBeVisible();
    // ...while a mention still does
    await a.send(`@${bob.username} olha isso`);
    await expect(rail.getByRole('button', { name: `${server.name}, 1 mensagem não lida` })).toBeVisible();

    // another tab (another device) gets both settings from the server
    const second = await bob.newTab(`/app/channels/${server.id}/${server.text.id}`);
    await expect(second.composer()).toBeVisible();
    await second.page.getByRole('button', { name: server.name, exact: true, expanded: false }).click();
    await expect(second.page.getByRole('menuitem', { name: /^Reativar servidor/ })).toBeVisible();
    await second.page.getByRole('menuitem', { name: 'Notificações' }).hover();
    await expect(second.page.getByRole('menuitemradio', { name: 'Todas as mensagens' })).toHaveAttribute('aria-checked', 'true');
    // Esc closes the submenu first, then the menu
    await second.page.keyboard.press('Escape');
    await second.page.keyboard.press('Escape');
    await expect(second.page.getByRole('menu')).toHaveCount(0);
    await second.page.getByRole('button', { name: 'Configurações de notificação' }).click();
    await second.page.getByRole('menuitem', { name: 'Notificações' }).hover();
    await expect(second.page.getByRole('menuitemradio', { name: 'Somente @menções' })).toHaveAttribute('aria-checked', 'true');
  });

  test('an icon picked in the server settings is cut on the server, animation and all', async ({ users }) => {
    const alice = await users.create('alice');
    const server = await createServer(alice.api, 'E2E icon');
    const a = await alice.app();
    await a.openChannel(server.id, server.text.id);

    // the header's menu button, not the rail icon of the same name
    await a.page.getByRole('button', { name: 'E2E icon', exact: true, expanded: false }).click();
    await a.page.getByRole('menuitem', { name: 'Configurações do servidor' }).click();
    const chooser = a.page.waitForEvent('filechooser');
    await a.page.getByRole('button', { name: 'Alterar ícone' }).click();
    await (await chooser).setFiles(threeFrameGif());
    const crop = a.page.getByRole('dialog', { name: 'Alterar ícone' });
    await crop.getByRole('button', { name: 'Salvar' }).click();
    await expect(crop).toHaveCount(0);

    // a fresh account has no picture of its own: the one upload on screen is the icon
    const icon = a.page.locator('img[src^="/uploads/"]').first();
    await expect(icon).toHaveAttribute('src', /^\/uploads\//);
    const bytes = await (await alice.api.get((await icon.getAttribute('src'))!)).body();
    expect(gifInfo(Buffer.from(bytes))).toEqual({ width: 200, height: 200, frames: 3 });
  });

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

  test('a member with only @everyone invites people without any server settings to open', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E plain member');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const b = await bob.app();
    await b.openChannel(server.id, server.text.id);

    // nothing in settings is a plain member's to change, so the menu does not offer them
    await b.page.getByRole('button', { name: server.name, exact: true, expanded: false }).click();
    await expect(b.page.getByRole('menuitem', { name: 'Convidar pessoas' })).toBeVisible();
    await expect(b.page.getByRole('menuitem', { name: 'Configurações do servidor' })).toHaveCount(0);
    await b.page.getByRole('menuitem', { name: 'Convidar pessoas' }).click();

    const dialog = b.page.getByRole('dialog', { name: `Convidar amigos para ${server.name}` });
    await expect(dialog.getByText(/\/invite\/[A-Za-z0-9]+/)).toBeVisible();
    // and the link works for someone else
    const code = (await dialog.getByText(/\/invite\//).textContent())!.split('/invite/')[1]!.trim();
    const carol = await users.create('carol');
    await acceptInvite(carol.api, code);
  });

  test('a voice channel without SPEAK lets a member in but keeps their microphone off', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E no speak');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    await setChannelOverwrite(alice.api, server.id, server.voice.id, server.everyoneRoleId, 0, PERMISSIONS.SPEAK);

    const b = await bob.app();
    await b.openChannel(server.id, server.text.id);
    await b.joinVoice(server.voice.name);
    const mic = b.page.getByRole('button', { name: 'Você não tem permissão para falar neste canal' }).first();
    await expect(mic).toHaveAttribute('aria-disabled', 'true');
    await expect(b.page.getByRole('button', { name: 'Ligar câmera' }).first()).toBeVisible();
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

test.describe('server audit log', () => {
  test('a moderator action shows in the audit log, which a plain member cannot open', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const carol = await users.create('carol');
    const server = await createServer(alice.api, 'E2E audit');
    const code = await createInvite(alice.api, server.id);
    await acceptInvite(bob.api, code);
    await acceptInvite(carol.api, code);
    expect((await alice.api.delete(`/api/servers/${server.id}/members/${carol.id}`)).ok()).toBe(true);
    await createChannel(alice.api, server.id, 'registro');

    const a = await alice.app();
    await a.openChannel(server.id, server.text.id);
    // the header's menu button, not the rail icon of the same name
    await a.page.getByRole('button', { name: 'E2E audit', exact: true, expanded: false }).click();
    await a.page.getByRole('menuitem', { name: 'Configurações do servidor' }).click();
    await a.page.getByRole('button', { name: 'Registro de auditoria' }).click();
    const log = a.page.getByRole('list', { name: 'Registro de auditoria' });
    await expect(log.getByText(`expulsou`)).toBeVisible();
    await expect(log.getByRole('button', { name: carol.username })).toBeVisible();
    await expect(log.getByText('criou o canal')).toBeVisible();

    // filtering by the person acted on leaves only what happened to them
    await log.getByRole('button', { name: carol.username }).click();
    await expect(log.getByText('criou o canal')).toHaveCount(0);
    await expect(log.getByText('expulsou')).toBeVisible();

    expect((await bob.api.get(`/api/servers/${server.id}/audit-log`)).status()).toBe(403);
    const auditor = await alice.api.post(`/api/servers/${server.id}/roles`, { data: { name: 'Auditor', permissions: PERMISSIONS.VIEW_AUDIT_LOG } });
    const { roleId } = await auditor.json();
    expect((await alice.api.put(`/api/servers/${server.id}/members/${bob.id}/roles`, { data: { roleIds: [roleId] } })).ok()).toBe(true);
    const page = await bob.api.get(`/api/servers/${server.id}/audit-log?action=member.kick`);
    expect(page.status()).toBe(200);
    expect((await page.json()).items).toHaveLength(1);
  });
});

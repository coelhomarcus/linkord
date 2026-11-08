import { test, expect } from '../../fixtures/test';
import { befriend } from '../../fixtures/api';

test.describe('friends', () => {
  test('a request sent from the form is accepted from Pending, and both can message', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const a = await alice.app();
    const b = await bob.app();

    await a.page.goto('/app/friends');
    await a.page.getByRole('button', { name: 'Adicionar amigo' }).first().click();
    await a.page.getByPlaceholder('@nomedeusuario').fill(bob.username);
    await a.page.getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect(a.page.getByText(`Solicitação enviada para @${bob.username}.`)).toBeVisible();

    await b.page.goto('/app/friends');
    await b.page.getByRole('link', { name: /^Pendentes/ }).click();
    await b.page.getByRole('button', { name: 'Aceitar' }).first().click();
    await expect(b.page.getByText('Solicitação aceita.')).toBeVisible();

    const dm = await a.openDmWith(bob.username);
    await a.send('agora somos amigos');
    await b.openDm(dm);
    await b.expectMessage('agora somos amigos');
  });

  test('a declined or cancelled request leaves no friendship', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const carol = await users.create('carol');

    expect((await alice.api.post('/api/friend-requests', { data: { username: bob.username } })).ok()).toBe(true);
    expect((await bob.api.post(`/api/friend-requests/${alice.id}/decline`, { data: {} })).ok()).toBe(true);
    expect((await alice.api.post('/api/friend-requests', { data: { username: carol.username } })).ok()).toBe(true);
    expect((await alice.api.post(`/api/friend-requests/${carol.id}/cancel`, { data: {} })).ok()).toBe(true);

    const friends = await (await alice.api.get('/api/friends')).json() as { items?: unknown[] };
    expect(friends.items ?? []).toHaveLength(0);
  });

  test('blocking stops the DM and the call; unblocking needs a new friendship', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const b = await bob.app();
    const dm = await b.openDmWith(alice.username);
    await b.send('antes do bloqueio');

    expect((await alice.api.post(`/api/blocks/${bob.id}`, { data: {} })).ok()).toBe(true);
    await b.page.reload();
    await expect(b.page.getByText('antes do bloqueio')).toBeVisible();
    await expect(b.composer()).toHaveCount(0);
    await expect(b.page.getByRole('button', { name: 'Ligar', exact: true })).toBeDisabled();

    expect((await alice.api.delete(`/api/blocks/${bob.id}`)).ok()).toBe(true);
    await b.page.goto(`/app/channels/@me/${dm}`);
    await expect(b.page.getByText('Vocês precisam ser amigos para trocar mensagens e fazer chamadas aqui.', { exact: false })).toBeVisible();
  });
});

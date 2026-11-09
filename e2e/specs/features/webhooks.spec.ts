import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { BASE_URL } from '../../stack/stack';
import { gifInfo, threeFrameGif } from '../../fixtures/images';

// docs/WEBHOOK.md is the contract these follow.
test.describe('webhooks', () => {
  test('a webhook posts text and a card to the channel, and a rotated URL stops the old one', async ({ users, playwright }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E webhooks');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const b = await bob.app();
    await b.openChannel(server.id, server.text.id);

    const created = await alice.api.post(`/api/channels/${server.text.id}/webhooks`, { data: { name: 'Deploy bot' } });
    expect(created.status()).toBe(201);
    const { webhook } = await created.json() as { webhook: { id: string; token: string; url: string } };
    const path = new URL(webhook.url).pathname;

    // the outside world: no session, no cookies
    const outside = await playwright.request.newContext({ baseURL: BASE_URL });
    expect((await outside.post(path, { data: { content: 'Deploy finished ✅' } })).ok()).toBe(true);
    await expect(b.page.getByText('Deploy finished ✅')).toBeVisible();

    const card = { content: 'Novo deploy', embeds: [{ title: 'Produção', description: 'versão 42 no ar', color: 0x57f287, fields: [{ name: 'Commit', value: 'abc123' }] }] };
    expect((await outside.post(`/api/webhooks/${webhook.id}`, { headers: { Authorization: `Bearer ${webhook.token}` }, data: card })).ok()).toBe(true);
    await expect(b.page.getByText('versão 42 no ar')).toBeVisible();
    await expect(b.page.getByText('abc123')).toBeVisible();

    const invalid = await outside.post(path, { data: {} });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).error.code).toBe('invalid_message');

    const rotated = await alice.api.post(`/api/channels/${server.text.id}/webhooks/${webhook.id}/rotate`, { data: {} });
    expect(rotated.ok()).toBe(true);
    const fresh = (await rotated.json() as { webhook: { url: string } }).webhook;
    expect((await outside.post(path, { data: { content: 'pela URL antiga' } })).ok()).toBe(false);
    expect((await outside.post(new URL(fresh.url).pathname, { data: { content: 'pela URL nova' } })).ok()).toBe(true);
    await expect(b.page.getByText('pela URL nova')).toBeVisible();

    expect((await alice.api.delete(`/api/channels/${server.text.id}/webhooks/${webhook.id}`)).ok()).toBe(true);
    expect((await outside.post(new URL(fresh.url).pathname, { data: { content: 'depois de excluir' } })).ok()).toBe(false);
    await outside.dispose();
  });

  test('a webhook picture picked in the channel settings is cut on the server', async ({ users }) => {
    const alice = await users.create('alice');
    const server = await createServer(alice.api, 'E2E webhook picture');
    expect((await alice.api.post(`/api/channels/${server.text.id}/webhooks`, { data: { name: 'Deploy bot' } })).status()).toBe(201);
    const a = await alice.app();
    await a.openChannel(server.id, server.text.id);

    await a.page.getByRole('button', { name: 'Editar canal' }).click();
    await a.page.getByRole('button', { name: 'Integrações' }).click();
    const chooser = a.page.waitForEvent('filechooser');
    await a.page.getByRole('button', { name: 'Imagem do webhook Deploy bot' }).click();
    await (await chooser).setFiles(threeFrameGif());
    const crop = a.page.getByRole('dialog', { name: 'Alterar imagem' });
    await crop.getByRole('button', { name: 'Salvar' }).click();
    await expect(crop).toHaveCount(0);

    const avatar = async () => (await (await alice.api.get(`/api/channels/${server.text.id}/webhooks`)).json() as { webhooks: { avatar: string }[] }).webhooks[0]!.avatar;
    await expect.poll(avatar).toMatch(/^\/uploads\//);
    const bytes = await (await alice.api.get(await avatar())).body();
    expect(gifInfo(Buffer.from(bytes))).toEqual({ width: 200, height: 200, frames: 3 });
  });

  // the route answers 404, not 403: it doesn't confirm the channel to someone who can't manage it
  test('a member without permission cannot create a webhook', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E webhooks perm');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const response = await bob.api.post(`/api/channels/${server.text.id}/webhooks`, { data: { name: 'nope' } });
    expect(response.status()).toBe(404);
  });
});

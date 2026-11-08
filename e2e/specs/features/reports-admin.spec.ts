import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { grantAdmin } from '../../stack/stack';

test.describe('reports and administration', () => {
  test('a reported message reaches the admin, who deletes it for everyone', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const admin = await users.create('admin');
    grantAdmin(admin.username);
    const server = await createServer(alice.api, 'E2E reports');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const a = await alice.app();
    const b = await bob.app();
    await a.openChannel(server.id, server.text.id);
    await b.openChannel(server.id, server.text.id);

    await a.send('compre agora, promoção imperdível');
    const row = b.message('compre agora, promoção imperdível');
    await row.hover();
    await row.getByRole('button', { name: 'Denunciar' }).click();
    await b.page.getByText('Spam ou propaganda').click();
    await b.page.getByRole('button', { name: 'Enviar denúncia' }).click();
    await expect(b.page.getByText('Denúncia enviada.')).toBeVisible();

    const list = await (await admin.api.get('/api/admin/reports')).json() as { items?: { id: string }[]; reports?: { id: string }[] };
    const report = (list.items ?? list.reports ?? [])[0];
    expect(report, 'the admin sees the report').toBeTruthy();
    const resolved = await admin.api.post(`/api/admin/reports/${report!.id}/resolve`, { data: { action: 'delete_message', reason: 'spam visto no teste' } });
    expect(resolved.ok(), await resolved.text()).toBe(true);
    await expect(a.message('compre agora, promoção imperdível')).toHaveCount(0);
    await expect(b.message('compre agora, promoção imperdível')).toHaveCount(0);
  });

  test('suspending an account ends its session; only an admin can do it', async ({ users }) => {
    const alice = await users.create('alice');
    const admin = await users.create('admin');
    grantAdmin(admin.username);

    expect((await alice.api.post(`/api/admin/users/${admin.id}/suspend`, { data: { reason: 'tentativa sem ser admin' } })).status()).toBe(403);

    const page = await alice.page();
    const suspended = await admin.api.post(`/api/admin/users/${alice.id}/suspend`, { data: { reason: 'conta de teste suspensa' } });
    expect(suspended.ok(), await suspended.text()).toBe(true);
    expect((await alice.api.get('/api/auth/me')).status()).toBe(401);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  });
});

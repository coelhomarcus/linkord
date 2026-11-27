import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { enableTwoFactor, signInAdminThroughApi } from '../../fixtures/admin';
import { ADMIN_URL, grantAdmin } from '../../stack/stack';

test.describe('reports and administration', () => {
  test('a reported message reaches the admin, who deletes it for everyone', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const admin = await users.create('admin');
    await enableTwoFactor(admin);
    grantAdmin(admin.username);
    await signInAdminThroughApi(admin);
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

    const list = await (await admin.api.get(`${ADMIN_URL}/api/admin/reports`)).json() as { items?: { id: string }[]; reports?: { id: string }[] };
    const report = (list.items ?? list.reports ?? [])[0];
    expect(report, 'the admin sees the report').toBeTruthy();
    const dashboard = await admin.context.newPage();
    await dashboard.goto(`${ADMIN_URL}/admin`);
    const queue = dashboard.getByRole('region', { name: 'Denúncias abertas' });
    await expect(queue.locator(`a[href="/admin/reports/${report!.id}"]`)).toBeVisible();
    const resolved = await admin.api.post(`${ADMIN_URL}/api/admin/reports/${report!.id}/resolve`, { data: { action: 'delete_message', reason: 'spam visto no teste' }, headers: { origin: ADMIN_URL } });
    expect(resolved.ok(), await resolved.text()).toBe(true);
    await expect(a.message('compre agora, promoção imperdível')).toHaveCount(0);
    await expect(b.message('compre agora, promoção imperdível')).toHaveCount(0);
  });

  test('suspending an account ends its session; only an admin can do it', async ({ users }) => {
    const alice = await users.create('alice');
    const admin = await users.create('admin');
    await enableTwoFactor(admin);
    grantAdmin(admin.username);
    await signInAdminThroughApi(admin);

    const refused = await alice.api.post(`${ADMIN_URL}/api/admin/auth/login`, {
      data: { username: alice.username, password: alice.password }, headers: { origin: ADMIN_URL },
    });
    expect(refused.status()).toBe(403);

    const page = await alice.page();
    const suspended = await admin.api.post(`${ADMIN_URL}/api/admin/users/${alice.id}/suspend`, { data: { reason: 'conta de teste suspensa' }, headers: { origin: ADMIN_URL } });
    expect(suspended.ok(), await suspended.text()).toBe(true);
    expect((await alice.api.get('/api/auth/me')).status()).toBe(401);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  });
});

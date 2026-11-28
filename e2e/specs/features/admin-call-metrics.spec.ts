import { ADMIN_CALL_METRICS_URL, enableTwoFactor, readAdminCallMetrics, signInAdminThroughApi } from '../../fixtures/admin';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { installScreenCapture } from '../../fixtures/screenShare';
import { expect, test } from '../../fixtures/test';
import { ADMIN_URL, grantAdmin } from '../../stack/stack';

test('the admin sees aggregate calls and screen peaks through a pause and resume', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  grantAdmin(alice.username);
  await enableTwoFactor(alice);
  await signInAdminThroughApi(alice);
  expect((await bob.api.get(ADMIN_CALL_METRICS_URL)).status()).toBe(401);

  const server = await createServer(alice.api, 'E2E call metrics');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  for (const app of [a, b]) {
    await app.openChannel(server.id, server.text.id);
    await app.joinVoice(server.voice.name);
  }
  await b.expectRemoteAudio(1);
  const read = () => readAdminCallMetrics(alice);
  const readScreens = async () => {
    const { screens } = (await read()).current;
    return screens && !screens.stale ? screens.count : null;
  };
  await expect.poll(readScreens, { timeout: 40_000 }).toBe(0);
  await installScreenCapture(b.page);
  await b.page.getByRole('button', { name: 'Compartilhar tela', exact: true }).first().click();
  await expect.poll(readScreens, { timeout: 40_000 }).toBe(1);
  await expect.poll(async () => (await read()).history.at(-1)?.screens ?? -1, { timeout: 40_000 }).toBeGreaterThanOrEqual(1);

  const snapshot = await read();
  expect(snapshot.current.calls).toBeGreaterThanOrEqual(1);
  expect(snapshot.current.accountsInCall).toBeGreaterThanOrEqual(2);
  expect(Object.keys(snapshot.current).sort()).toEqual(['accountsInCall', 'at', 'calls', 'onlineAccounts', 'screens']);
  expect(snapshot.history).toHaveLength(7);
  expect(Object.keys(snapshot.history.at(-1)!).sort()).toEqual(['calls', 'day', 'screens']);
  const serialized = JSON.stringify(snapshot);
  for (const personal of [alice.id, bob.id, alice.username, bob.username, server.voice.id]) {
    expect(serialized).not.toContain(personal);
  }

  const page = await alice.context.newPage();
  await page.goto(ADMIN_URL);
  await page.getByRole('link', { name: 'Ver histórico', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Chamadas e transmissões', exact: true })).toBeVisible();
  const live = page.getByRole('region', { name: 'Atividade ao vivo', exact: true });
  const screenCount = live.getByRole('definition').nth(1);
  await expect(screenCount).toHaveText('1', { timeout: 40_000 });
  await expect(page.getByRole('region', { name: 'Picos de telas transmitindo', exact: true }).getByRole('listitem')).toHaveCount(7);

  const settings = b.page.getByRole('button', { name: 'Configurações de compartilhamento de tela', exact: true }).first();
  await settings.click();
  await b.page.getByRole('menuitem', { name: 'Pausar prévia', exact: true }).click();
  await expect(screenCount).toHaveText('0', { timeout: 40_000 });
  expect((await read()).history.at(-1)?.screens).toBe(snapshot.history.at(-1)?.screens);
  await settings.click();
  await b.page.getByRole('menuitem', { name: 'Retomar prévia', exact: true }).click();
  await expect(screenCount).toHaveText('1', { timeout: 40_000 });
  await b.page.getByRole('button', { name: 'Parar compartilhamento', exact: true }).first().click();
  await expect(screenCount).toHaveText('0', { timeout: 40_000 });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.getByRole('main').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

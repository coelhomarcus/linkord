import { test, expect } from '../../fixtures/test';
import { acceptInvite, befriend, createInvite, createServer } from '../../fixtures/api';
import { HEAD_IMAGE, baseVersion, headProtocol, type BaseVersion } from '../../stack/images';
import { deploy, down, up } from '../../stack/stack';

// The next deploy, rehearsed: people are using the version in production
// (E2E_BASE_REF, origin/main by default) when the server is upgraded to the
// working tree. Their tabs keep running the old JavaScript; new tabs get the
// new one; both have to work together. See AGENTS.md, "Realtime compatibility
// and deploys".
test.describe.configure({ mode: 'serial' });

let base: BaseVersion;

test.beforeAll(async () => {
  test.setTimeout(900_000);
  base = baseVersion();
  // a fresh database that starts on the old version's schema, as production does
  down();
  await up(base.image);
});

test.afterAll(async () => {
  test.setTimeout(300_000);
  down();
  await up(HEAD_IMAGE);
});

test('tabs opened on the production version keep working with tabs on the new one', async ({ users }) => {
  test.info().annotations.push({ type: 'base', description: `${base.ref} (${base.sha.slice(0, 12)})` });

  const alice = await users.create('alice');
  const bob = await users.create('bob');
  await befriend(alice, bob);
  const server = await createServer(alice.api, 'E2E upgrade');
  const code = await createInvite(alice.api, server.id);
  await acceptInvite(bob.api, code);

  // old JavaScript, loaded from the old server
  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);
  await a.send('antes do deploy');
  await b.expectMessage('antes do deploy');
  await a.joinVoice(server.voice.name);

  await deploy(HEAD_IMAGE);

  if (headProtocol().minProtocolVersion > base.protocolVersion) {
    // the new server refuses the old protocol: the only right outcome is the update screen
    await expect(a.page.getByText('Há uma versão nova do Linkord')).toBeVisible();
    await expect(b.page.getByText('Há uma versão nova do Linkord')).toBeVisible();
    return;
  }

  if (!base.shutdownLetsTabsReconnect) {
    test.info().annotations.push({ type: 'known limit', description: 'the base version disconnects every socket on shutdown, so its tabs come back only when focused' });
    for (const tab of [a, b]) await tab.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  }

  // new JavaScript, loaded from the new server
  const carol = await users.create('carol');
  await acceptInvite(carol.api, code);
  const c = await carol.app();
  await c.openChannel(server.id, server.text.id);

  // inside the app, never page.goto: a reload would swap the old JavaScript for the new
  await a.page.getByRole('navigation').getByText(server.text.name, { exact: true }).click();
  await a.send('aba antiga depois do deploy');
  await c.expectMessage('aba antiga depois do deploy');
  await c.send('aba nova depois do deploy');
  await a.expectMessage('aba nova depois do deploy');
  await b.expectMessage('aba nova depois do deploy');

  // a friend request across versions, accepted in the old tab
  expect((await carol.api.post('/api/friend-requests', { data: { username: bob.username } })).ok()).toBe(true);
  await b.page.getByRole('button', { name: 'Mensagens diretas' }).first().click();
  await b.page.getByText('Amigos', { exact: true }).first().click();
  await b.page.getByRole('link', { name: /^Pendentes/ }).click();
  await b.page.getByRole('button', { name: 'Aceitar' }).first().click();
  await expect(b.page.getByText('Solicitação aceita.')).toBeVisible();

  // the voice call Alice was in before the deploy
  await c.joinVoice(server.voice.name);
  await a.page.getByRole('navigation').getByRole('button', { name: server.voice.name, exact: true }).click();
  if (base.restoresCalls) {
    await a.expectTilesFor([alice.username, carol.username]);
    await c.expectTilesFor([alice.username, carol.username]);
    await a.expectRemoteAudio(1);
    await c.expectRemoteAudio(1);
  } else {
    test.info().annotations.push({ type: 'known limit', description: 'the base version does not persist calls: whoever was in a call before this deploy has to join again' });
    await a.page.getByRole('button', { name: 'Sair da chamada' }).first().click();
    await a.joinVoice(server.voice.name);
    await a.expectTilesFor([alice.username, carol.username]);
    await c.expectTilesFor([alice.username, carol.username]);
  }
});

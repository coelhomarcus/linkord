import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { backendTask, replaceFrontend, SPLIT_LIVEKIT_URL, sql } from '../../stack/stack';

const REPLACEMENT = 'split frontend replacement';

test('the frontend can be replaced during a call without reconnecting either client', async ({ users, request }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E split deploy');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const [a, b] = await Promise.all([alice.app(), bob.app()]);
  await Promise.all([a.openChannel(server.id, server.text.id), b.openChannel(server.id, server.text.id)]);
  await a.joinVoice(server.voice.name);
  await b.joinVoice(server.voice.name);
  for (const client of [a, b]) {
    await client.page.getByRole('navigation', { name: 'Canais' })
      .getByRole('button', { name: server.text.name, exact: true }).click();
  }
  await Promise.all([a.expectRemoteAudio(1), b.expectRemoteAudio(1)]);
  expect(await a.page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL)).toMatch(/\/sw\.js$/);

  const index = await request.get('/index.html');
  expect(await index.text()).not.toContain(REPLACEMENT);
  const task = backendTask();
  const disconnects = [a.socketDisconnects.length, b.socketDisconnects.length];
  await replaceFrontend();

  const message = 'Mensagem durante a troca da web';
  const file = Buffer.from('attachment over the backend route');
  await a.page.locator('input[type=file]:not([accept])').setInputFiles({ name: 'deploy.txt', mimeType: 'text/plain', buffer: file });
  await a.send(message);
  await b.expectMessage(message);
  await expect(b.message(message).getByText('deploy.txt')).toBeVisible();
  const attachmentId = sql("SELECT id FROM attachments WHERE file_name = 'deploy.txt'");
  expect(attachmentId).toMatch(/^[a-f0-9]{32}$/);
  const attachment = await bob.api.get(`/uploads/${attachmentId}`);
  expect(attachment.ok()).toBe(true);
  expect(await attachment.body()).toEqual(file);
  await Promise.all([a.expectRemoteAudio(1), b.expectRemoteAudio(1)]);
  expect([a.socketDisconnects.length, b.socketDisconnects.length]).toEqual(disconnects);
  expect(backendTask()).toBe(task);

  const newPage = await alice.context.newPage();
  const deepLink = await newPage.goto(`/app/channels/${server.id}/${server.text.id}`);
  expect(deepLink?.ok()).toBe(true);
  expect(await deepLink?.text()).toContain(REPLACEMENT);
  await expect(newPage.getByPlaceholder(/Conversar/)).toBeVisible();
});

test('Traefik forwards backend routes while the web returns the right CSP and cache policy', async ({ request }) => {
  const index = await request.get('/app/friends');
  expect(index.ok()).toBe(true);
  expect(index.headers()['cache-control']).toBe('no-cache');
  expect(index.headers()['content-security-policy']).toContain(SPLIT_LIVEKIT_URL);
  expect(index.headers()['content-security-policy']).toContain("script-src 'self' 'sha256-");
  const assetPath = (await index.text()).match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  expect(assetPath).toBeTruthy();
  const asset = await request.get(assetPath!);
  expect(asset.ok()).toBe(true);
  expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  for (const path of ['/offline.html', '/sw.js']) expect((await request.get(path)).headers()['cache-control']).toBe('no-cache');
  expect((await request.get('/assets/deleted.js')).status()).toBe(404);
  expect((await request.get('/apiary')).headers()['content-type']).toContain('text/html');
  expect((await request.get('/api')).headers()['content-type']).toContain('application/json');
  expect((await request.get('/readyz')).ok()).toBe(true);
  expect((await request.get('/ws/?EIO=4&transport=polling')).ok()).toBe(true);
  expect((await request.get(`/uploads/${'0'.repeat(32)}`)).status()).toBe(401);
});

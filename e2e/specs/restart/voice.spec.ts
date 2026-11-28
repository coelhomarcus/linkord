import { test, expect } from '../../fixtures/test';
import { enableTwoFactor, readAdminCallMetrics, signInAdminThroughApi } from '../../fixtures/admin';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { deploy, grantAdmin, restartLiveKit } from '../../stack/stack';
import { expectStreamImage, installScreenCapture, screenTile, watchButton } from '../../fixtures/screenShare';

// A redeploy must look like a short network drop to a voice call: the media
// stays on LiveKit, the server restores who is in the call, every tab
// reconnects on its own (even one nobody is looking at), and someone who
// joins after the deploy lands in the same call. See AGENTS.md, "Realtime
// compatibility and deploys".
test('a voice call survives a redeploy, and a newcomer joins the same call', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E voice restart');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));

  const a = await alice.app();
  await a.openChannel(server.id, server.text.id);
  await a.joinVoice(server.voice.name);
  await a.expectTilesFor([alice.username]);

  await deploy();

  const b = await bob.app();
  await b.openChannel(server.id, server.text.id);
  await b.joinVoice(server.voice.name);

  // Alice's tab was never focused again: it has to come back by itself
  await a.expectTilesFor([alice.username, bob.username]);
  await b.expectTilesFor([alice.username, bob.username]);
  await a.expectRemoteAudio(1);
  await b.expectRemoteAudio(1);
  expect(a.socketDisconnects, 'the shutdown must drop the transport, not send a disconnect').not.toContain('io server disconnect');
});

test('a redeploy and an SFU restart restore only the chosen screen', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  grantAdmin(alice.username);
  await enableTwoFactor(alice);
  await signInAdminThroughApi(alice);
  const server = await createServer(alice.api, 'E2E watch restart');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  for (const tab of [a, b]) {
    await tab.openChannel(server.id, server.text.id);
    await tab.joinVoice(server.voice.name);
  }
  await a.expectRemoteAudio(1);
  for (const tab of [a, b]) {
    await installScreenCapture(tab.page);
    await tab.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
  }
  const watching = screenTile(b.page, alice.username);
  const untouched = screenTile(a.page, bob.username);
  await watchButton(watching, alice.username).click();
  await expectStreamImage(watching);
  await expect(watchButton(untouched, bob.username)).toBeVisible();
  await b.expectRemoteAudio(2);
  await a.expectRemoteAudio(1);

  const readPeak = async () => (await readAdminCallMetrics(alice)).history.at(-1);
  await expect.poll(async () => (await readPeak())?.screens ?? -1, { timeout: 45_000 }).toBeGreaterThanOrEqual(2);
  const peak = await readPeak();
  const ready = [a, b].map((tab) => tab.waitForSocketEvent('welcome', 60_000));
  await Promise.all([deploy(), ...ready]);
  expect((await readAdminCallMetrics(alice)).history.find((day) => day.day === peak?.day)).toEqual(peak);
  await expectStreamImage(watching);
  await expect(watchButton(untouched, bob.username)).toBeVisible();
  await expect(untouched.locator('video')).toHaveCount(0);
  await b.expectRemoteAudio(2);
  await a.expectRemoteAudio(1);

  const receivingTrack = () => watching.locator('video').evaluate((video: HTMLVideoElement) =>
    video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks()[0]?.id : undefined);
  const beforeSfuRestart = await receivingTrack();
  expect(beforeSfuRestart).toBeTruthy();
  restartLiveKit();
  await expect.poll(receivingTrack, { timeout: 60_000 }).not.toBe(beforeSfuRestart);
  await expectStreamImage(watching);
  await expect(watchButton(untouched, bob.username)).toBeVisible();
  await expect(untouched.locator('video')).toHaveCount(0);
  await b.expectRemoteAudio(2);
  await a.expectRemoteAudio(1);
});

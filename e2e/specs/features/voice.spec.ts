import { test, expect, type User } from '../../fixtures/test';
import { acceptInvite, createChannel, createInvite, createServer, type CreatedServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';
import { expectStreamImage, installScreenCapture, observeCallRtp, outboundScreenVideo, publishedAudio, receivedCallTracks, screenTile, silenceScreenAudio, watchButton } from '../../fixtures/screenShare';

async function twoInVoice(users: { create(prefix?: string): Promise<User> }): Promise<{ alice: User; bob: User; a: AppPage; b: AppPage; server: CreatedServer }> {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E voice');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);
  await a.joinVoice(server.voice.name);
  await b.joinVoice(server.voice.name);
  return { alice, bob, a, b, server };
}

test.describe('voice channels', () => {
  test('two people in a voice channel see and hear each other', async ({ users }) => {
    const { alice, bob, a, b } = await twoInVoice(users);
    await a.expectTilesFor([alice.username, bob.username]);
    await b.expectTilesFor([alice.username, bob.username]);
    await a.expectRemoteAudio(1);
    await b.expectRemoteAudio(1);
  });

  test('muting shows on the other side, and the camera becomes a video tile', async ({ users }) => {
    const { bob, a, b } = await twoInVoice(users);
    await b.page.getByRole('button', { name: 'Mutar' }).first().click();
    await expect(a.page.getByLabel('Microfone desativado').first()).toBeVisible();

    await b.page.getByRole('button', { name: 'Ligar câmera' }).first().click();
    await expect(a.page.locator('[data-tile-kind="camera"]').filter({ hasText: bob.username })).toBeVisible();
    await b.page.getByRole('button', { name: 'Parar câmera' }).first().click();
    await expect(a.page.locator('[data-tile-kind="camera"]')).toHaveCount(0);
  });

  test('sharing the screen shows the share to the other member until it stops', async ({ users }) => {
    const { alice, bob, a, b } = await twoInVoice(users);
    await a.page.setViewportSize({ width: 1600, height: 1000 });
    // Sharing is refused until the tab reaches LiveKit; hearing the other side proves it has.
    await b.expectRemoteAudio(1);
    // The fake media UI accepts the picker with a fake screen, like a person choosing one.
    await b.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
    const share = screenTile(a.page, bob.username);
    const watch = watchButton(share, bob.username);
    const expectCenteredWatch = async (minHeight: number) => {
      await expect(watch.locator('svg')).toBeVisible();
      await expect(async () => {
        const tile = (await share.boundingBox())!;
        const button = (await watch.boundingBox())!;
        expect(button.height).toBeGreaterThanOrEqual(minHeight);
        expect(Math.abs(button.x + button.width / 2 - tile.x - tile.width / 2)).toBeLessThan(1);
        expect(Math.abs(button.y + button.height / 2 - tile.y - tile.height / 2)).toBeLessThan(1);
      }).toPass();
    };
    await expectCenteredWatch(44);
    await a.page.getByRole('button', { name: `Destacar ${alice.username}`, exact: true }).click();
    await expect(a.page.locator('[data-thumb-strip]').getByRole('button', { name: `Assistir à transmissão de ${bob.username}`, exact: true })).toBeVisible();
    await expectCenteredWatch(36);
    await expect(share.locator('video')).toHaveCount(0);
    await watch.click();
    await expectStreamImage(share);
    await b.page.getByRole('button', { name: 'Parar compartilhamento' }).first().click();
    await expect(a.page.locator('[data-tile-kind="screen"]')).toHaveCount(0);
  });

  test('a viewer keeps watching through a source change and a screen republish', async ({ users }) => {
    const { bob, a, b } = await twoInVoice(users);
    await b.expectRemoteAudio(1);
    await installScreenCapture(b.page, 1, [[1280, 720], [960, 720], [720, 720]]);
    await b.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();

    const share = screenTile(a.page, bob.username);
    const video = share.locator('video');
    const readAspectRatio = () => video.evaluate((el: HTMLVideoElement) => el.videoWidth / el.videoHeight);
    const settingsName = 'Configurações de compartilhamento de tela';
    const openSettings = b.page.getByRole('button', { name: settingsName }).first();
    const settings = b.page.getByRole('menu', { name: settingsName });
    const changeSource = settings.getByRole('menuitem', { name: 'Trocar fonte' });

    await watchButton(share, bob.username).click();
    await share.press('Enter');
    await expect(share).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(readAspectRatio).toBeCloseTo(16 / 9);
    await a.expectRemoteAudio(2);
    await openSettings.click();
    await changeSource.click();
    await expect.poll(readAspectRatio).toBeCloseTo(4 / 3);
    await expect(share).toHaveAttribute('aria-pressed', 'true');
    await expect(watchButton(share, bob.username)).toHaveCount(0);
    await a.expectRemoteAudio(2);

    // Applying a new publisher quality with the next source requires republishing.
    await openSettings.click();
    const quality = settings.getByRole('menuitemradio', { name: 'Tela (1080p, 30 fps)' });
    await quality.click();
    await expect(quality).toHaveAttribute('aria-checked', 'true');
    await changeSource.click();
    await expect.poll(readAspectRatio).toBeCloseTo(1);
    await expect(share).toHaveAttribute('aria-pressed', 'true');
    await expect(watchButton(share, bob.username)).toHaveCount(0);
    await a.expectRemoteAudio(2);
  });

  test('screen share adapts to thumbnail and fullscreen while hidden video leaves audio playing', async ({ users }) => {
    const { alice, bob, a, b } = await twoInVoice(users);
    await b.expectRemoteAudio(1);
    await a.page.setViewportSize({ width: 1600, height: 1000 });
    await a.page.evaluate(() => {
      // Keep access to inbound RTP stats after the thumbnail is unmounted.
      const getStats = RTCRtpReceiver.prototype.getStats;
      let videoReceiver: RTCRtpReceiver | undefined;
      RTCRtpReceiver.prototype.getStats = function () {
        if (this.track.kind === 'video') videoReceiver = this;
        return getStats.call(this);
      };
      Object.assign(window, {
        screenShareBytes: async () => {
          const report = videoReceiver && await getStats.call(videoReceiver);
          const inbound = report && [...report.values()].find((stat) => stat.type === 'inbound-rtp');
          return Number(inbound?.bytesReceived ?? 0);
        },
      });
    });
    await installScreenCapture(b.page);

    await b.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
    const share = a.page.locator('[data-tile-kind="screen"]').filter({ hasText: bob.username });
    const video = share.locator('video');
    const menu = share.getByRole('button', { name: `Mais ações de ${bob.username}` });
    const receivedBytes = () => a.page.evaluate(() => (window as typeof window & { screenShareBytes(): Promise<number> }).screenShareBytes());
    const expectWidth = async (width: number) => {
      await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(width);
    };
    await expect(share).toBeVisible();
    await a.expectRemoteAudio(1);
    await a.page.getByRole('button', { name: `Destacar ${alice.username}`, exact: true }).click();
    await watchButton(share, bob.username).click();
    await a.expectRemoteAudio(2);
    await expectWidth(640);

    await menu.press('Enter');
    await a.page.getByRole('menuitem', { name: 'Tela cheia' }).click();
    await expectWidth(1280);
    await a.page.evaluate(() => document.exitFullscreen());
    await expectWidth(640);

    await expect.poll(receivedBytes).toBeGreaterThan(0);
    await a.page.getByRole('button', { name: 'Ocultar participantes' }).click();
    await expect(share).toHaveCount(0);
    await expect.poll(async () => {
      const before = await receivedBytes();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return await receivedBytes() - before;
    }).toBe(0);
    await a.expectRemoteAudio(2);
    await a.page.getByRole('button', { name: 'Mostrar participantes' }).click();
    await expectWidth(640);

    await menu.press('Enter');
    await a.page.getByRole('menuitem', { name: 'Parar de assistir' }).click();
    await expect(share.getByText('Você parou de assistir')).toBeVisible();
    await a.expectRemoteAudio(1);
    await watchButton(share, bob.username).click();
    await expectWidth(640);
    await a.expectRemoteAudio(2);
  });

  test('"ao vivo" joins and highlights the tile, then starts screen media only on confirmation', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E watch');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const a = await alice.app();
    const b = await bob.app();
    await a.openChannel(server.id, server.text.id);
    await b.openChannel(server.id, server.text.id);
    await a.joinVoice(server.voice.name);
    // Sharing is refused until the tab reaches LiveKit, and alone in the call there is no audio to wait for.
    await expect(async () => {
      await a.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
      await expect(a.page.locator('[data-tile-kind="screen"]')).toBeVisible({ timeout: 2_000 });
    }).toPass();

    // bob is not in the call: hovering the badge shows the still with "Assistir" over it
    const badge = b.page.getByRole('button', { name: `Ao vivo: assistir à transmissão de ${alice.username}` });
    await badge.hover();
    // exact: the badge's own name ends with the same words
    await b.page.getByRole('button', { name: `Assistir à transmissão de ${alice.username}`, exact: true }).click();
    await expect(b.page.getByText('Em chamada')).toBeVisible();
    const share = b.page.locator('[data-tile-kind="screen"]').filter({ hasText: alice.username });
    await expect(share).toHaveAttribute('aria-pressed', 'true');
    await expect(share.locator('video')).toHaveCount(0);
    await watchButton(share, alice.username).click();
    await expectStreamImage(share);

    // in the call, the badge itself focuses the share again
    await b.page.keyboard.press('Escape');
    await expect(share).toHaveAttribute('aria-pressed', 'false');
    await badge.click();
    await expect(share).toHaveAttribute('aria-pressed', 'true');
  });

  test('mic and camera arrive automatically while each screen and its audio require a watch', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const carol = await users.create('carol');
    const server = await createServer(alice.api, 'E2E media choice');
    const invite = await createInvite(alice.api, server.id);
    await acceptInvite(bob.api, invite);
    await acceptInvite(carol.api, invite);
    await observeCallRtp(alice.context);
    await observeCallRtp(bob.context);
    const a = await alice.app();
    const b = await bob.app();
    const c = await carol.app();
    for (const tab of [a, b, c]) await tab.openChannel(server.id, server.text.id);

    await a.joinVoice(server.voice.name);
    await a.expectTilesFor([alice.username]);
    await a.page.getByRole('button', { name: 'Ligar câmera' }).first().click();
    await expect(a.page.locator('[data-tile-kind="camera"]')).toBeVisible();
    await installScreenCapture(a.page, 2);
    await a.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
    await expect(screenTile(a.page, alice.username)).toBeVisible();

    await b.joinVoice(server.voice.name);
    const first = screenTile(b.page, alice.username);
    await expect(watchButton(first, alice.username)).toBeVisible();
    await expect.poll(() => receivedCallTracks(b.page)).toEqual({ audio: 1, video: 1 });

    await c.joinVoice(server.voice.name);
    await c.expectRemoteAudio(2);
    await c.page.getByRole('button', { name: 'Ligar câmera' }).first().click();
    await installScreenCapture(c.page);
    await c.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
    const second = screenTile(b.page, carol.username);
    await expect(watchButton(second, carol.username)).toBeVisible();
    await expect.poll(() => receivedCallTracks(b.page)).toEqual({ audio: 2, video: 2 });

    await watchButton(first, alice.username).click();
    await expectStreamImage(first);
    await expect.poll(() => outboundScreenVideo(a.page)).toBeGreaterThan(0);
    await b.expectRemoteAudio(2);
    await screenTile(a.page, alice.username).getByRole('button', { name: `Mais ações de ${alice.username}` }).press('Enter');
    await a.page.getByRole('menuitem', { name: 'Trocar fonte' }).click();
    await b.expectRemoteAudio(3);
    await expect.poll(() => publishedAudio(a.page)).toMatchObject({ microphoneDtx: true, screenDtx: true });
    async function screenAudioDelta() {
      const before = (await publishedAudio(a.page)).screenBytes;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return (await publishedAudio(a.page)).screenBytes - before;
    }
    const withSound = await screenAudioDelta();
    expect(withSound).toBeGreaterThan(0);
    await silenceScreenAudio(a.page, true);
    await expect.poll(screenAudioDelta).toBeLessThan(withSound / 2);
    await silenceScreenAudio(a.page, false);

    await watchButton(second, carol.username).click();
    await expectStreamImage(first);
    await expectStreamImage(second);
    await b.expectRemoteAudio(4);

    await first.getByRole('button', { name: `Mais ações de ${alice.username}` }).press('Enter');
    await b.page.getByRole('menuitem', { name: 'Parar de assistir' }).click();
    await expect(first.getByText('Você parou de assistir')).toBeVisible();
    await expectStreamImage(second);
    await b.expectRemoteAudio(3);
    await expect.poll(async () => {
      const before = await outboundScreenVideo(a.page);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return await outboundScreenVideo(a.page) - before;
    }, { timeout: 30_000 }).toBe(0);

    await c.page.getByRole('button', { name: 'Parar compartilhamento' }).first().click();
    await expect(second).toHaveCount(0);
    await c.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
    await expect(watchButton(second, carol.username)).toBeVisible();
    await expect(second.locator('video')).toHaveCount(0);
    await b.expectRemoteAudio(2);
    await watchButton(second, carol.username).click();
    await expectStreamImage(second);
    await b.expectRemoteAudio(3);
  });

  test('leaving the call removes the tile for the other member', async ({ users }) => {
    const { bob, a, b } = await twoInVoice(users);
    await a.expectTilesFor([bob.username]);
    await b.page.getByRole('button', { name: 'Sair da chamada' }).first().click();
    await expect(a.participant(bob.username)).toHaveCount(0);
    await a.expectRemoteAudio(0);
  });

  test('the owner moves a member to another voice channel, then disconnects them', async ({ users }) => {
    const { alice, bob, a, b, server } = await twoInVoice(users);
    await createChannel(alice.api, server.id, 'Outra sala', 'voice');
    const rosterEntry = () => a.page.getByRole('navigation').getByText(bob.username, { exact: true }).first();

    // moderation goes through the voice roster's menu in the sidebar, like a moderator would
    await rosterEntry().click({ button: 'right' });
    await a.page.getByRole('menuitem', { name: 'Outra sala' }).click();
    await expect(a.participant(bob.username)).toHaveCount(0);
    await expect(b.page.getByText('Em chamada')).toBeVisible();
    await b.expectTilesFor([bob.username]);

    await rosterEntry().click({ button: 'right' });
    await a.page.getByRole('menuitem', { name: 'Desconectar' }).click();
    await expect(b.page.getByText('Em chamada')).toHaveCount(0);
  });
});

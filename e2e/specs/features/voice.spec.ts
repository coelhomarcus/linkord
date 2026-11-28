import { test, expect, type User } from '../../fixtures/test';
import { acceptInvite, createChannel, createInvite, createServer, type CreatedServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

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
    const { bob, a, b } = await twoInVoice(users);
    // Sharing is refused until the tab reaches LiveKit; hearing the other side proves it has.
    await b.expectRemoteAudio(1);
    // The fake media UI accepts the picker with a fake screen, like a person choosing one.
    await b.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
    await expect(a.page.locator('[data-tile-kind="screen"]').filter({ hasText: bob.username })).toBeVisible();
    await b.page.getByRole('button', { name: 'Parar compartilhamento' }).first().click();
    await expect(a.page.locator('[data-tile-kind="screen"]')).toHaveCount(0);
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
    await b.page.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {
        configurable: true,
        value: async () => {
          const canvas = document.createElement('canvas');
          canvas.width = 1280;
          canvas.height = 720;
          const frame = canvas.getContext('2d')!;
          let x = 0;
          function draw() {
            frame.fillStyle = '#123456';
            frame.fillRect(0, 0, canvas.width, canvas.height);
            frame.fillStyle = '#fedcba';
            frame.fillRect(x++ % canvas.width, 0, 64, canvas.height);
          }
          draw();
          const stream = canvas.captureStream(30);
          const [video] = stream.getVideoTracks();
          const settings = video.getSettings.bind(video);
          video.getSettings = () => ({ ...settings(), displaySurface: 'browser' });
          const timer = setInterval(draw, 33);
          video.addEventListener('ended', () => clearInterval(timer), { once: true });

          const audio = new AudioContext();
          const destination = audio.createMediaStreamDestination();
          const oscillator = audio.createOscillator();
          oscillator.connect(destination);
          oscillator.start();
          await audio.resume();
          stream.addTrack(destination.stream.getAudioTracks()[0]);
          return stream;
        },
      });
    });

    await b.page.getByRole('button', { name: 'Compartilhar tela' }).first().click();
    const share = a.page.locator('[data-tile-kind="screen"]').filter({ hasText: bob.username });
    const video = share.locator('video');
    const menu = share.getByRole('button', { name: `Mais ações de ${bob.username}` });
    const receivedBytes = () => a.page.evaluate(() => (window as typeof window & { screenShareBytes(): Promise<number> }).screenShareBytes());
    const expectWidth = async (width: number) => {
      await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.videoWidth)).toBe(width);
    };
    await expect(share).toBeVisible();
    await a.expectRemoteAudio(2);
    await a.page.getByRole('button', { name: `Destacar ${alice.username}`, exact: true }).click();
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
    await menu.press('Enter');
    await a.page.getByRole('menuitem', { name: 'Assistir', exact: true }).click();
    await expectWidth(640);
    await a.expectRemoteAudio(2);
  });

  test('"ao vivo" in the channel list joins the call focused on that share, and focuses it again from inside', async ({ users }) => {
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

    // in the call, the badge itself focuses the share again
    await b.page.keyboard.press('Escape');
    await expect(share).toHaveAttribute('aria-pressed', 'false');
    await badge.click();
    await expect(share).toHaveAttribute('aria-pressed', 'true');
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

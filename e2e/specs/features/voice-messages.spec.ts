import type { Page } from '@playwright/test';
import { test, expect, type User } from '../../fixtures/test';
import { acceptInvite, befriend, createInvite, createServer, type CreatedServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

// Chrome runs with --use-fake-device-for-media-stream, so the "microphone" is
// its built-in beep: real capture, real MediaRecorder, real upload.

async function recordTake(page: Page, seconds: string): Promise<void> {
  await page.getByRole('button', { name: 'Gravar mensagem de voz' }).click();
  await expect(page.getByRole('group', { name: 'Gravando mensagem de voz' })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(seconds);
}

/** Back to #geral from the call stage through the sidebar: a reload would leave the call. */
async function backToText(app: AppPage): Promise<void> {
  await app.page.getByRole('navigation').getByText('geral', { exact: true }).click();
  // a take waiting for review stands in for the text field
  await expect(app.composer().or(app.page.getByRole('group', { name: 'Revisar mensagem de voz' }))).toBeVisible();
}

async function twoInVoice(users: { create(prefix?: string): Promise<User> }): Promise<{ alice: User; bob: User; a: AppPage; b: AppPage; server: CreatedServer }> {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E voice message');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);
  await b.joinVoice(server.voice.name);
  return { alice, bob, a, b, server };
}

test.describe('voice messages', () => {
  test('recorded and reviewed in a DM, it plays back for the friend with its duration shown up front', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const a = await alice.app();
    const b = await bob.app();
    const dm = await a.openDmWith(bob.username);

    await recordTake(a.page, '0:02');
    await a.page.getByRole('button', { name: 'Parar e revisar' }).click();
    await expect(a.page.getByRole('group', { name: 'Revisar mensagem de voz' })).toBeVisible();
    await a.page.getByRole('button', { name: 'Enviar mensagem de voz' }).click();
    // the DM only shows up on Bob's side once it has a message
    await expect(a.page.locator('[data-message-id]').getByRole('group', { name: /^Mensagem de voz/ })).toBeVisible();
    await b.openDm(dm);

    const player = b.page.getByRole('group', { name: /^Mensagem de voz, 0:0[2-9]$/ });
    await expect(player).toBeVisible();
    await player.getByRole('button', { name: 'Reproduzir mensagem de voz' }).click();
    await expect.poll(() => player.locator('audio').evaluate((el: HTMLAudioElement) => (el.error ? -1 : el.currentTime))).toBeGreaterThan(0.3);
    await expect(player.getByRole('slider', { name: 'Posição da mensagem de voz' })).not.toHaveAttribute('aria-valuetext', /^0:00 de/);
  });

  test('in a call, recording is refused and the call keeps its microphone', async ({ users }) => {
    const { alice, a, b, server } = await twoInVoice(users);
    await a.joinVoice(server.voice.name);
    await b.expectRemoteAudio(1);
    await backToText(a);

    await a.page.getByRole('button', { name: 'Gravar mensagem de voz' }).click();
    await expect(a.page.getByRole('alert')).toContainText('Saia dela para gravar uma mensagem de voz');
    await expect(a.page.getByRole('group', { name: 'Gravando mensagem de voz' })).toHaveCount(0);

    // the other side still hears Alice, unmuted
    await b.expectRemoteAudio(1);
    await expect(b.participant(alice.username).getByLabel('Microfone desativado')).toHaveCount(0);

    // leaving the call lifts the block
    await a.page.getByRole('button', { name: 'Sair da chamada' }).first().click();
    await expect(a.page.getByRole('alert')).toHaveCount(0);
    await recordTake(a.page, '0:01');
  });

  test('joining a call mid-take keeps the take for review, and the call starts with a working microphone', async ({ users }) => {
    const { alice, a, b, server } = await twoInVoice(users);
    await recordTake(a.page, '0:02');

    // the call stage replaces the chat, so the composer goes away: the take is
    // stopped there, before the call asks for the mic, and kept as a draft
    await a.joinVoice(server.voice.name);
    await b.expectTilesFor([alice.username]);
    await b.expectRemoteAudio(1);
    await expect(b.participant(alice.username).getByLabel('Microfone desativado')).toHaveCount(0);
    await backToText(a);
    await expect(a.page.getByRole('group', { name: 'Revisar mensagem de voz' })).toBeVisible();

    // the take is still sendable from inside the call
    await a.page.getByRole('button', { name: 'Enviar mensagem de voz' }).click();
    await backToText(b);
    await expect(b.page.getByRole('group', { name: /^Mensagem de voz, 0:0\d$/ })).toBeVisible();
    await b.expectRemoteAudio(1);
  });
});

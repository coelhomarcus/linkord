import { expect, type Locator, type Page } from '@playwright/test';

/** Page-level helpers. They find things the way a person does, by the pt-BR
 * labels the app renders (the suite runs the browser in pt-BR, like web/tests),
 * and by the few data attributes the app already exposes. */
export class AppPage {
  /** reasons the socket reported for each disconnect, from the app's own log line */
  readonly socketDisconnects: string[] = [];

  constructor(readonly page: Page) {
    page.on('console', async (message) => {
      if (!message.text().includes('socket disconnected')) return;
      const args = await Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => null)));
      const detail = args.find((arg): arg is { reason: string } => !!arg && typeof arg === 'object' && 'reason' in arg);
      this.socketDisconnects.push(detail?.reason ?? 'unknown');
    });
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  async openChannel(serverId: string, channelId: string): Promise<void> {
    await this.page.goto(`/app/channels/${serverId}/${channelId}`);
    await expect(this.composer()).toBeVisible();
  }

  composer(): Locator {
    return this.page.getByPlaceholder(/^Conversar (em|com) /);
  }

  async send(text: string): Promise<void> {
    const composer = this.composer();
    await composer.click();
    await composer.fill(text);
    await composer.press('Enter');
  }

  /** Confirmed (stored) messages only: a pending copy has no message id yet. */
  message(text: string): Locator {
    return this.page.locator('[data-message-id]').filter({ hasText: text });
  }

  async expectMessage(text: string, times = 1): Promise<void> {
    await expect(this.message(text)).toHaveCount(times);
  }

  /** Clicks a voice channel in the sidebar and waits for the call bar. */
  async joinVoice(channelName: string): Promise<void> {
    await this.page.getByRole('button', { name: channelName, exact: true }).click();
    await expect(this.page.getByText('Em chamada')).toBeVisible();
  }

  tiles(): Locator {
    return this.page.locator('[data-tile-kind]');
  }

  /** Every name has a tile on this screen (camera, avatar or screen). */
  async expectTilesFor(usernames: string[]): Promise<void> {
    for (const name of usernames) await expect(this.tiles().filter({ hasText: name }).first()).toBeVisible();
  }

  /** How many remote audio tracks are actually playing here. */
  async liveRemoteAudio(): Promise<number> {
    return this.page.evaluate(() => [...document.querySelectorAll('audio')]
      .filter((el) => el.srcObject instanceof MediaStream && el.srcObject.getAudioTracks().some((t) => t.readyState === 'live'))
      .length);
  }

  async expectRemoteAudio(count: number): Promise<void> {
    await expect.poll(() => this.liveRemoteAudio()).toBe(count);
  }
}

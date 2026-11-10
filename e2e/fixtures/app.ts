import { expect, type Locator, type Page } from '@playwright/test';

/** Page-level helpers. They find things the way a person does, by the pt-BR
 * labels the app renders (the suite runs the browser in pt-BR, like web/tests),
 * and by the few data attributes the app already exposes. */
export class AppPage {
  /** reasons the socket reported for each disconnect, from the app's own log line */
  readonly socketDisconnects: string[] = [];

  private readonly socketEvents: { name: string; waiters: ((payload: unknown) => void)[] }[] = [];

  /** Attach before the page navigates: the app opens its socket on load. */
  constructor(readonly page: Page) {
    // Socket.IO starts on HTTP long-polling and upgrades to a WebSocket, so an
    // event (the first `welcome` of a reconnect, typically) can come either way.
    page.on('websocket', (ws) => {
      ws.on('framereceived', ({ payload }) => { if (typeof payload === 'string') this.onPacket(payload); });
    });
    page.on('response', async (response) => {
      if (!response.url().includes('/ws/?') || !response.url().includes('transport=polling') || response.request().method() !== 'GET') return;
      // several packets in one polling response are separated by the record separator
      const body = await response.text().catch(() => '');
      for (const packet of body.split('\x1e')) this.onPacket(packet);
    });
    page.on('console', async (message) => {
      if (!message.text().includes('socket disconnected')) return;
      const args = await Promise.all(message.args().map((arg) => arg.jsonValue().catch(() => null)));
      const detail = args.find((arg): arg is { reason: string } => !!arg && typeof arg === 'object' && 'reason' in arg);
      this.socketDisconnects.push(detail?.reason ?? 'unknown');
    });
  }

  /** A Socket.IO event packet is `42["name", {...}]`. */
  private onPacket(packet: string): void {
    if (!packet.startsWith('42')) return;
    let parsed: unknown;
    try { parsed = JSON.parse(packet.slice(2)); } catch { return; }
    if (!Array.isArray(parsed) || typeof parsed[0] !== 'string') return;
    for (const entry of this.socketEvents) {
      if (entry.name !== parsed[0]) continue;
      for (const resolve of entry.waiters.splice(0)) resolve(parsed[1]);
    }
  }

  /** Resolves with the payload of the next server event of that name this page receives. */
  waitForSocketEvent(name: string, timeoutMs = 20_000): Promise<unknown> {
    let entry = this.socketEvents.find((e) => e.name === name);
    if (!entry) { entry = { name, waiters: [] }; this.socketEvents.push(entry); }
    const waiters = entry.waiters;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${name}" socket event within ${timeoutMs} ms`)), timeoutMs);
      waiters.push((payload) => { clearTimeout(timer); resolve(payload); });
    });
  }

  async goto(path: string): Promise<void> {
    await this.page.goto(path);
  }

  async openChannel(serverId: string, channelId: string): Promise<void> {
    await this.page.goto(`/app/channels/${serverId}/${channelId}`);
    await expect(this.composer()).toBeVisible();
  }

  /** Opens (or creates) the DM with a friend from the friends page, like a
   * person would, and returns its conversation id. */
  async openDmWith(username: string): Promise<string> {
    await this.page.goto('/app/friends');
    // the URL is not a reliable source here (the app may keep it as is), but the
    // server always answers the open with the conversation
    const opened = this.waitForSocketEvent('conversation-opened');
    await this.page.getByRole('button', { name: `Enviar mensagem para ${username}` }).first().click();
    const { conversationId } = await opened as { conversationId: string };
    await expect(this.composer()).toBeVisible();
    return conversationId;
  }

  async openDm(conversationId: string): Promise<void> {
    await this.page.goto(`/app/channels/@me/${encodeURIComponent(conversationId)}`);
    await expect(this.composer()).toBeVisible();
  }

  /** The message box (a rich text field carrying a placeholder attribute, like
   * the textarea it was); with files attached it asks for a caption instead. */
  composer(): Locator {
    return this.page.getByPlaceholder(/^(Conversar (em|com) |Adicionar legenda)/);
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

  /** Everyone shown in the call here: a voice channel's tiles, or a DM call's
   * avatars (which carry the name in their label instead of their text). */
  tiles(): Locator {
    return this.page.locator('[data-tile-kind], [data-dm-call-avatar]');
  }

  participant(name: string): Locator {
    return this.page.locator('[data-tile-kind]').filter({ hasText: name })
      .or(this.page.locator(`[data-dm-call-avatar][aria-label^="${name}"]`));
  }

  /** Every name is shown in the call on this screen (camera, avatar or screen). */
  async expectTilesFor(usernames: string[]): Promise<void> {
    for (const name of usernames) await expect(this.participant(name).first()).toBeVisible();
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

import { createRequire } from 'node:module';
import type { Browser, Page } from '@playwright/test';
import { test, expect, type User } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer, type CreatedServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

interface CallToken { conversationId: string; livekitUrl: string; livekitToken: string }

/** Alice and Bob in one voice channel, with the LiveKit token Bob's tab received. */
async function twoInVoice(users: { create(prefix?: string): Promise<User> }): Promise<{ alice: User; bob: User; a: AppPage; b: AppPage; server: CreatedServer; bobToken: CallToken }> {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E call membership');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);
  await a.joinVoice(server.voice.name);
  const token = b.waitForSocketEvent('call-token');
  await b.joinVoice(server.voice.name);
  const bobToken = await token as CallToken;
  await a.expectTilesFor([alice.username, bob.username]);
  await a.expectRemoteAudio(1);
  return { alice, bob, a, b, server, bobToken };
}

/** A LiveKit client outside the app, holding a token it kept: what a modified client would do.
 * A blank page of its own, so nothing of the app (its socket, its call-leave) comes with it. */
class KeptTokenClient {
  private constructor(private readonly page: Page) {}

  static async open(browser: Browser): Promise<KeptTokenClient> {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.setContent('<!doctype html><title>kept token</title>');
    // the suite's own copy (CI installs only e2e/), pinned to the web app's version; `require` resolves to the UMD build
    await page.addScriptTag({ path: createRequire(import.meta.url).resolve('livekit-client') });
    return new KeptTokenClient(page);
  }

  /**
   * Connects with the token. The server may remove the identity while LiveKit is still setting the
   * connection up (it already removed it once, or the takeover's call-leave lands first), and then
   * the attempt fails instead of connecting. `ifCutOff` says what to do then: `'accept'` counts it
   * as removed, `'retry'` tries again (the next sweep is seconds away).
   */
  async connect(token: CallToken, ifCutOff: 'accept' | 'retry'): Promise<void> {
    await this.page.evaluate(async ({ livekitUrl, livekitToken, ifCutOff }) => {
      // the UMD build loaded into this page provides it, not an import of the suite
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lk = (window as unknown as { LivekitClient: any }).LivekitClient;
      for (let attempt = 1; ; attempt++) {
        // a fresh state per attempt: a failed one's late events must not read as this one's removal
        const state = { connected: false, removed: false, cutOff: false, remoteAudio: 0 };
        (window as unknown as { kept: typeof state }).kept = state;
        const room = new lk.Room();
        room.on(lk.RoomEvent.TrackSubscribed, (track: { kind: string }) => { if (track.kind === 'audio') state.remoteAudio++; });
        room.on(lk.RoomEvent.Disconnected, (reason?: number) => {
          state.connected = false;
          state.removed = reason === lk.DisconnectReason.PARTICIPANT_REMOVED;
        });
        try {
          await room.connect(livekitUrl, livekitToken);
          state.connected = true;
          return;
        } catch (err) {
          if (ifCutOff === 'retry' && attempt < 3) continue;
          if (ifCutOff === 'accept') { state.cutOff = true; return; }
          throw err;
        }
      }
    }, { ...token, ifCutOff });
  }

  state(): Promise<{ connected: boolean; removed: boolean; cutOff: boolean; remoteAudio: number }> {
    return this.page.evaluate(() => (window as unknown as { kept: { connected: boolean; removed: boolean; cutOff: boolean; remoteAudio: number } }).kept);
  }

  /** Removed by the server, or never let in. */
  async expectRemoved(timeout: number): Promise<void> {
    await expect.poll(async () => { const s = await this.state(); return s.removed || s.cutOff; }, { timeout }).toBe(true);
    expect((await this.state()).connected).toBe(false);
  }

  close(): Promise<void> {
    return this.page.context().close();
  }
}

/** From now on, `window.sawTile` turns true once this screen shows a call tile with that name. */
async function watchForTile(app: AppPage, username: string): Promise<void> {
  await app.page.evaluate((name) => {
    const w = window as unknown as { sawTile: boolean };
    w.sawTile = false;
    const check = () => {
      if ([...document.querySelectorAll('[data-tile-kind]')].some((el) => el.textContent?.includes(name))) w.sawTile = true;
    };
    new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true });
    check();
  }, username);
}

// The server sweeps its rooms every 15 s; an identity it already removed goes on the first sweep.
const SWEEP_WINDOW_MS = 35_000;

test.describe('call membership on LiveKit', () => {
  test('a client that leaves over the socket but keeps its token is removed from the room, and shown while it is there', async ({ users, browser }) => {
    const { bob, a, b, bobToken } = await twoInVoice(users);
    const kept = await KeptTokenClient.open(browser);
    try {
      // Taking over Bob's identity drops his tab from LiveKit, and the tab answers with call-leave:
      // the server now has Bob out of the call while this client is still in the room.
      await kept.connect(bobToken, 'accept');
      await expect(b.page.getByText('Em chamada')).toHaveCount(0);
      await kept.expectRemoved(10_000);

      // The token is still valid: coming back with it works, but never unseen and not for long.
      // The sweep can land any moment after connecting, so the tile may live too briefly to be
      // caught visible: Alice's page records whether it ever showed one.
      await expect(a.participant(bob.username)).toHaveCount(0);
      await watchForTile(a, bob.username);
      await kept.connect(bobToken, 'retry');
      await expect.poll(() => a.page.evaluate(() => (window as unknown as { sawTile: boolean }).sawTile), { timeout: 20_000 }).toBe(true);
      await kept.expectRemoved(SWEEP_WINDOW_MS);
      await expect(a.participant(bob.username)).toHaveCount(0);
    } finally {
      await kept.close();
    }
  });

  test('a banned member who reconnects with the token they kept is removed again', async ({ users, browser }) => {
    const { alice, bob, a, b, server, bobToken } = await twoInVoice(users);
    expect((await alice.api.put(`/api/servers/${server.id}/bans/${bob.id}`, { data: {} })).ok()).toBe(true);
    await expect(b.page.getByText('Em chamada')).toHaveCount(0);
    await expect(a.participant(bob.username)).toHaveCount(0);

    const kept = await KeptTokenClient.open(browser);
    try {
      await kept.connect(bobToken, 'accept');
      await kept.expectRemoved(SWEEP_WINDOW_MS);
      await expect(a.participant(bob.username)).toHaveCount(0);
    } finally {
      await kept.close();
    }
  });
});

import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { BASE_URL } from '../../stack/stack';

// Every spec already fails on a Content-Security-Policy violation (the `users`
// fixture watches the console); these check what the policy is there for.

test.describe('security headers', () => {
  test('another site cannot put the app in a frame', async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      // another site, served by the test itself: a page of the app would block the frame with its own frame-src first
      await page.route('http://attacker.test/', (route) => route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><iframe src="${BASE_URL}/app" width="800" height="600"></iframe>`,
      }));
      await page.goto('http://attacker.test/');
      const framed = () => page.frames().find((frame) => frame !== page.mainFrame());
      // Chrome swaps a refused frame for its own error page
      await expect.poll(() => framed()?.url()).toMatch(/^chrome-error:/);
      await expect(framed()!.locator('#root')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('a blocked script is refused and reported to the server', async ({ browser }) => {
    // outside the fixture, which would fail on the very violation this provokes
    const context = await browser.newContext({ baseURL: BASE_URL });
    try {
      const page = await context.newPage();
      await page.goto('/');
      const report = page.waitForResponse((response) => response.url().endsWith('/api/csp-reports') && response.request().method() === 'POST');
      const loaded = await page.evaluate(() => new Promise<boolean>((resolve) => {
        const script = document.createElement('script');
        script.src = 'https://attacker.test/payload.js';
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      }));
      expect(loaded).toBe(false);
      expect((await report).status()).toBe(204);
    } finally {
      await context.close();
    }
  });

  test('a YouTube link plays in YouTube\'s own frame, with no script of theirs in the page', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E embeds');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const a = await alice.app();
    const b = await bob.app();
    await a.openChannel(server.id, server.text.id);
    await b.openChannel(server.id, server.text.id);

    await a.send('https://youtu.be/dQw4w9WgXcQ?t=42');
    await b.page.getByRole('button', { name: 'Reproduzir vídeo' }).click();
    const player = b.page.locator('iframe[title="YouTube"]');
    await expect(player).toHaveAttribute('src', /^https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ\?.*start=42/);
    expect(await b.page.locator('script[src*="youtube"]').count()).toBe(0);
  });
});

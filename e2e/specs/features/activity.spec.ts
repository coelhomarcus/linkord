import { test, expect } from '../../fixtures/test';
import type { BrowserContext } from '@playwright/test';
import { befriend } from '../../fixtures/api';

/** Stands in for the desktop app's bridge (`window.linkordDesktop`, desktop/src/preload): the page sees a
 * game running, and the test switches it with `window.__setActivity`. No Electron, the same reporting
 * path as the real app (useActivityReporter). */
async function fakeDesktop(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    type Found = { key: string; kind: 'playing' | 'using'; name: string; startedAt: number } | null;
    let current: Found = null;
    const listeners = new Set<(activity: Found) => void>();
    const w = window as unknown as { linkordDesktop: unknown; __setActivity: (activity: Found) => void };
    w.__setActivity = (activity) => { current = activity; for (const listener of listeners) listener(activity); };
    w.linkordDesktop = {
      platform: 'win32',
      version: '0.0.0-e2e',
      activity: {
        watch: async () => {},
        current: async () => current,
        recent: async () => [],
        icon: async () => null,
        onChange: (callback: (activity: Found) => void) => { listeners.add(callback); return () => listeners.delete(callback); },
      },
    };
  });
}

test.describe('activity', () => {
  test("a friend's profile shows what they play now, with its timer, and what they played before", async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    await fakeDesktop(bob.context);
    const b = await bob.app();

    const play = (key: string, name: string, minutesAgo: number) => b.page.evaluate(
      ([k, n, m]) => (window as unknown as { __setActivity: (a: unknown) => void }).__setActivity({ key: k, kind: 'playing', name: n, startedAt: Date.now() - m * 60_000 }),
      [key, name, minutesAgo] as const,
    );
    await play('minecraft', 'Minecraft', 30);
    // what others saw is in the history once it shows: then the next game takes its place
    await expect.poll(async () => (await (await alice.api.get(`/api/users/${bob.id}/activity`)).json() as { items: unknown[] }).items.length).toBe(1);
    await play('steam:570', 'Dota 2', 79);

    const a = await alice.app();
    const row = a.page.getByRole('button', { name: `Ver perfil de ${bob.username}` });
    await expect(row).toContainText('Jogando Dota 2');
    await row.click();

    const profile = a.page.getByRole('dialog');
    await profile.getByRole('tab', { name: 'Atividade' }).click();
    const current = profile.getByRole('region', { name: 'Atividade atual' });
    await expect(current).toContainText('Dota 2');
    await expect(current.getByRole('timer')).toHaveText(/^1:19:\d\d$/);
    const recent = profile.getByRole('region', { name: 'Atividade recente' });
    await expect(recent.getByRole('listitem')).toHaveText([/Minecraft.*Agora há pouco/]);
  });
});

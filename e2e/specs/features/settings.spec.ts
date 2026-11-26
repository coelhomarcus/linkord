import { test, expect } from '../../fixtures/test';

test.describe('settings', () => {
  test('the language chosen on the account follows it to a new browser', async ({ users }) => {
    const alice = await users.create('alice');
    const page = await alice.page();
    await page.goto('/friends');
    await expect(page.getByRole('link', { name: 'Todos', exact: true })).toBeVisible();

    expect((await alice.api.patch('/api/me/locale', { data: { locale: 'en-US' } })).ok()).toBe(true);
    const elsewhere = await users.login(alice.username, alice.password);
    const other = await elsewhere.page();
    await other.goto('/friends');
    await expect(other.getByRole('link', { name: 'All', exact: true })).toBeVisible();
  });

  test('the mascot illustrations follow the accent and stay readable in every theme', async ({ users }, testInfo) => {
    const alice = await users.create('alice');
    const settings = await alice.page();
    await settings.goto('/settings/appearance');
    const friends = await alice.newTab('/friends');
    const illustration = friends.page.locator('[data-slot="empty-state"]')
      .filter({ hasText: 'Adicione amigos para começar uma conversa' }).locator(':scope > svg');

    const mascotColors = new Set<string>();
    for (const [id, name] of [
      ['black', 'Black'], ['old', 'Old'], ['graphite', 'Graphite'], ['latte', 'Catppuccin Latte'],
      ['frappe', 'Catppuccin Frappé'], ['macchiato', 'Catppuccin Macchiato'], ['mocha', 'Catppuccin Mocha'],
    ]) {
      await settings.getByRole('radio', { name: `Tema ${name}` }).click();
      await expect(friends.page.locator('html')).toHaveAttribute('data-theme', id);
      const image = await illustration.screenshot();
      const palette = await friends.page.evaluate(async (png) => {
        const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        function pixel(x: number, y: number) {
          const { data } = context.getImageData(
            Math.floor(bitmap.width * x / 160), Math.floor(bitmap.height * y / 120), 1, 1,
          );
          return [data[0]!, data[1]!, data[2]!] as const;
        }
        const backdrop = pixel(80, 18);
        const body = pixel(51, 81);
        context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-accent-primary').trim();
        context.fillRect(0, 0, 1, 1);
        return { backdrop, body, accent: pixel(0, 0) };
      }, image.toString('base64'));
      const hue = ([r, g, b]: typeof palette.body) => [r - g, g - b] as const;
      const [bodyRedGreen, bodyGreenBlue] = hue(palette.body);
      const [accentRedGreen, accentGreenBlue] = hue(palette.accent);
      const agreement = (bodyRedGreen * accentRedGreen + bodyGreenBlue * accentGreenBlue)
        / (Math.hypot(bodyRedGreen, bodyGreenBlue) * Math.hypot(accentRedGreen, accentGreenBlue));
      expect(agreement).toBeGreaterThan(0.95);
      expect(Math.max(...palette.body) - Math.min(...palette.body)).toBeGreaterThan(25);
      const lightness = ([r, g, b]: typeof palette.body) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
      expect(Math.abs(lightness(palette.backdrop) - lightness(palette.body))).toBeGreaterThan(20);
      mascotColors.add(palette.body.join(','));
      await testInfo.attach(id, { body: image, contentType: 'image/png' });
    }
    expect(mascotColors.size).toBe(7);
  });

  test('account settings follow it to another browser at once, device settings stay', async ({ users }) => {
    const alice = await users.create('alice');
    const here = await alice.page();
    await here.goto('/settings/appearance');
    await expect(here.getByRole('radio', { name: 'Tema Black' })).toHaveAttribute('aria-checked', 'true');

    const elsewhere = await users.login(alice.username, alice.password);
    const there = await elsewhere.page();
    await there.goto('/friends');
    await expect(there.getByRole('link', { name: 'Todos', exact: true })).toBeVisible();

    await here.getByRole('radio', { name: 'Tema Catppuccin Mocha' }).click();
    await here.getByText('Maior', { exact: true }).click();
    await expect(here.locator('html')).toHaveAttribute('data-text-size', 'larger');
    await expect(there.locator('html')).toHaveAttribute('data-theme', 'mocha');
    await expect(there.locator('html')).not.toHaveAttribute('data-text-size', 'larger');

    // and a new sign-in starts with it before anything is changed there
    const third = await (await users.login(alice.username, alice.password)).page();
    await third.goto('/friends');
    await expect(third.locator('html')).toHaveAttribute('data-theme', 'mocha');
  });
});

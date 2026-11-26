import { test, expect } from '../../fixtures/test';
import type { Locator, Page } from '@playwright/test';
import { befriend } from '../../fixtures/api';
import { gifInfo, threeFrameGif } from '../../fixtures/images';

test.describe('profile', () => {
  test('a display name and bio saved on the profile page reach a friend', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const a = await alice.app();
    const b = await bob.app();
    await b.openDmWith(alice.username);

    await a.page.goto('/app/profile');
    // the user panel has an icon button with the same name; this one has the text
    await a.page.getByRole('button', { name: 'Meu perfil' }).filter({ hasText: 'Meu perfil' }).click();
    await a.page.getByLabel('Nome de exibição').fill('Alice Testes');
    await a.page.getByPlaceholder('Fale um pouco sobre você...').fill('bio escrita pelo teste');
    const bar = a.page.getByRole('region', { name: 'Salvar alterações do perfil' });
    await bar.getByRole('button', { name: 'Salvar' }).click();
    await expect(a.page.getByText('Alterações salvas.')).toBeVisible();

    // Bob still has the DM open: the new name reaches him without a reload
    await expect(b.page.getByText('Alice Testes').first()).toBeVisible();
    const profile = await (await bob.api.get(`/api/users/${alice.id}/profile`)).json() as { user?: { bio?: string }; bio?: string };
    expect(profile.user?.bio ?? profile.bio).toBe('bio escrita pelo teste');
  });

  test('a GIF picked as photo and as banner is cut on the server and stays animated', async ({ users }) => {
    const alice = await users.create('alice');
    const a = await alice.app();
    await a.page.goto('/app/profile');
    await a.page.getByRole('button', { name: 'Meu perfil' }).filter({ hasText: 'Meu perfil' }).click();

    const profile = async () => (await (await alice.api.get(`/api/users/${alice.id}/profile`)).json() as { user: { avatar: string; avatarPoster: string; banner: string } }).user;
    const stored = async (url: string) => gifInfo(Buffer.from(await (await alice.api.get(url)).body()));
    const pick = async (menu: string, dialog: string) => {
      await a.page.getByRole('button', { name: menu }).click();
      const chooser = a.page.waitForEvent('filechooser');
      await a.page.getByRole('menuitem', { name: 'Enviar do computador' }).click();
      await (await chooser).setFiles(threeFrameGif());
      const crop = a.page.getByRole('dialog', { name: dialog });
      await crop.getByRole('button', { name: 'Salvar' }).click();
      await expect(crop).toHaveCount(0);
    };

    await pick('Alterar foto de perfil', 'Recortar foto de perfil');
    await expect.poll(async () => (await profile()).avatar).toMatch(/^\/uploads\//);
    // the dialog opens on the centred square: 200px of the 300x200 picture
    expect(await stored((await profile()).avatar)).toEqual({ width: 200, height: 200, frames: 3 });
    expect((await profile()).avatarPoster).toMatch(/^\/uploads\//);

    await pick('Alterar banner', 'Recortar banner');
    await expect.poll(async () => (await profile()).banner).toMatch(/^\/uploads\//);
    // 16:9 across the whole width; the dialog rounds the height either way
    const banner = await stored((await profile()).banner);
    expect([banner.width, banner.frames]).toEqual([300, 3]);
    expect(banner.height).toBeGreaterThanOrEqual(168);
    expect(banner.height).toBeLessThanOrEqual(169);
  });

  test('a friend\'s profile shows the servers and friends in common', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const carol = await users.create('carol');
    await befriend(alice, bob);
    await befriend(alice, carol);
    await befriend(bob, carol);

    const a = await alice.app();
    await a.openDmWith(bob.username);
    await expect(a.page.getByText('1 amigo mútuo').first()).toBeVisible();
  });

  test('the games widgets are on offer without any connection, and the search says it is unavailable without IGDB credentials', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const a = await alice.app();

    await a.page.goto('/app/profile');
    await a.page.getByRole('button', { name: 'Meu perfil' }).filter({ hasText: 'Meu perfil' }).click();
    await a.page.getByRole('tab', { name: 'Mural' }).click();
    await a.page.getByRole('button', { name: 'Adicionar widget' }).click();
    // the catalog is a window over the profile; the games widgets are there with no connection
    const catalog = a.page.getByRole('dialog', { name: 'Adicionar widget de perfil' });
    const navigation = catalog.getByRole('navigation', { name: 'Tipos de widget' });
    await expect(navigation.getByRole('group', { name: 'Do Overcord' }).getByRole('button', { name: 'Jogos' })).toBeVisible();
    await expect(navigation.getByRole('group', { name: 'Integrações' }).getByRole('button', { name: 'GitHub' })).toBeVisible();
    await catalog.getByRole('button', { name: 'Jogo favorito' }).click();
    // an empty place opens the search in a window; the e2e stack has no IGDB credentials, so it says so
    await a.page.getByRole('button', { name: 'Adicionar jogo a Jogo favorito' }).click();
    await a.page.getByRole('searchbox', { name: 'Buscar jogo' }).fill('zelda');
    await expect(a.page.getByRole('dialog', { name: 'Escolher jogo' }).getByText('A busca de jogos está indisponível no momento.')).toBeVisible();
    await a.page.keyboard.press('Escape');
    await expect(a.page.getByRole('dialog', { name: 'Escolher jogo' })).toBeHidden();
    // the Save bar floats over the profile; nothing is published before it
    const bar = a.page.getByRole('region', { name: 'Salvar alterações do Mural' });
    await expect(bar.getByText('Não se esqueça de salvar suas alterações!')).toBeVisible();
    expect((await (await bob.api.get(`/api/users/${alice.id}/wall`)).json() as { widgets: unknown[] }).widgets).toEqual([]);
    await bar.getByRole('button', { name: 'Salvar' }).click();
    await expect(bar).toBeHidden();
    await expect(a.page.getByRole('article').getByRole('heading', { name: 'Jogo favorito' })).toBeVisible();

    const wall = await (await bob.api.get(`/api/users/${alice.id}/wall`)).json() as { widgets: { type: string; connection: unknown }[] };
    expect(wall.widgets.map((widget) => [widget.type, widget.connection])).toEqual([['igdb-favorite-game', null]]);
  });

  test('a friend sees the account handle in the profile connections', async ({ users }) => {
    const viewer = await users.create('viewer');
    const owner = await users.create('owner');
    await befriend(viewer, owner);
    const url = 'https://github.com/octocat';
    const connected = await owner.api.post('/api/me/connections', { data: { provider: 'url', value: url } });
    expect(connected.status()).toBe(201);

    const app = await viewer.app();
    await app.page.goto('/app/friends');
    await app.page.getByRole('button', { name: `Ver perfil de ${owner.username}`, exact: true }).click();
    const links = app.page.getByRole('dialog').getByRole('region', { name: 'Conexões' });
    const link = links.getByRole('link', { name: 'Abrir @octocat em GitHub' });
    await expect(link).toHaveText('@octocat');
    await expect(link).toHaveAttribute('href', url);
  });

  test('games saved with the Wall reach a friend, in order', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    const game = (igdbId: number) => ({ igdbId, name: `Game ${igdbId}`, slug: `game-${igdbId}`, coverImageId: 'co1abc', releaseYear: 2001 });
    const saved = await alice.api.put('/api/me/wall', { data: {
      widgets: [{ connectionId: null, type: 'igdb-playing-games' }],
      games: { playing: [game(2), game(1)] },
    } });
    expect(saved.status()).toBe(200);
    const wall = await (await bob.api.get(`/api/users/${alice.id}/wall`)).json() as { widgets: { data: { items: { name: string; imageUrl: string }[] } }[] };
    expect(wall.widgets[0]!.data.items.map((item) => item.name)).toEqual(['Game 2', 'Game 1']);
    expect(wall.widgets[0]!.data.items[0]!.imageUrl).toBe('/api/media-proxy/igdb/cover_big/co1abc');
  });

  test('Steam covers respond to hover individually while editing the Wall', async ({ users }) => {
    const owner = await users.create('owner');
    const { page } = await owner.app();
    const imageUrl = '/e2e-fixture/steam-cover.gif';
    const items = [['570', 'Dota 2'], ['440', 'Team Fortress 2']].map(([id, title]) => ({
      id, title, imageUrl, minutes: 90, url: `https://store.steampowered.com/app/${id}/`,
    }));
    const widgets = ['steam-recent', 'steam-top'].map((type) => ({ connection: null, type, data: { kind: 'steam-games', items } }));
    await page.route(`**${imageUrl}`, (route) => route.fulfill({ contentType: 'image/gif', body: threeFrameGif().buffer }));
    // Supply the Steam snapshots through the Wall response so the test can run without a Steam account or key.
    await page.route(/\/api\/me\/wall\?catalog=2$/, async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...await response.json(), widgets, available: widgets } });
    });

    await page.goto('/app/profile');
    await page.getByRole('button', { name: 'Meu perfil' }).filter({ hasText: 'Meu perfil' }).click();
    await page.getByRole('tab', { name: 'Mural' }).click();

    for (const name of ['Jogados recentemente (Steam)', 'Mais jogados entre os recentes (Steam)']) {
      const heading = page.getByRole('heading', { name, exact: true });
      const widget = page.getByRole('article').filter({ has: heading });
      const dota = widget.getByRole('link', { name: 'Dota 2' });
      const teamFortress = widget.getByRole('link', { name: 'Team Fortress 2' });

      await heading.hover();
      await expect(page.getByRole('button', { name: `Remover ${name}` })).toHaveCSS('pointer-events', 'auto');
      await expect(dota.locator('img')).toHaveCSS('scale', 'none');
      await expect(teamFortress.locator('img')).toHaveCSS('scale', 'none');

      await dota.hover();
      await expect(dota.locator('img')).toHaveCSS('scale', '1.05');
      await expect(teamFortress.locator('img')).toHaveCSS('scale', 'none');

      await teamFortress.hover();
      await expect(teamFortress.locator('img')).toHaveCSS('scale', '1.05');
      await expect(dota.locator('img')).toHaveCSS('scale', 'none');
    }
  });

  test('widgets are reordered by dragging the handle beside them, and removed with the button under it', async ({ users }) => {
    const alice = await users.create('alice');
    const saved = await alice.api.put('/api/me/wall', { data: { widgets: [
      { connectionId: null, type: 'igdb-favorite-game' }, { connectionId: null, type: 'igdb-wishlist-games' }, { connectionId: null, type: 'igdb-liked-games' },
    ] } });
    expect(saved.status()).toBe(200);
    const a = await alice.app();
    await a.page.goto('/app/profile');
    await a.page.getByRole('button', { name: 'Meu perfil' }).filter({ hasText: 'Meu perfil' }).click();
    await a.page.getByRole('tab', { name: 'Mural' }).click();

    // the second widget, still inside the modal's viewport, dragged above the first
    const handle = a.page.getByRole('button', { name: 'Reordenar Quero jogar' });
    const target = a.page.getByRole('article').filter({ hasText: 'Jogo favorito' });
    await a.page.getByRole('article').filter({ hasText: 'Quero jogar' }).hover();
    const from = (await handle.boundingBox())!;
    const to = (await target.boundingBox())!;
    await a.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await a.page.mouse.down();
    await a.page.mouse.move(from.x + from.width / 2, to.y + 10, { steps: 12 });
    await a.page.mouse.move(from.x + from.width / 2, to.y + 5, { steps: 4 });
    await a.page.mouse.up();
    await dropSettled(a.page);
    await a.page.getByRole('article').filter({ hasText: 'Jogos que eu gosto' }).hover();
    await a.page.getByRole('button', { name: 'Remover Jogos que eu gosto' }).click();

    const bar = a.page.getByRole('region', { name: 'Salvar alterações do Mural' });
    await bar.getByRole('button', { name: 'Salvar' }).click();
    await expect(bar).toBeHidden();
    const wall = await (await alice.api.get(`/api/users/${alice.id}/wall`)).json() as { widgets: { type: string }[] };
    expect(wall.widgets.map((widget) => widget.type)).toEqual(['igdb-wishlist-games', 'igdb-favorite-game']);
  });
});

/** Whether a tap anywhere in the 44px square around the control's centre lands on it (where that square is
 * on the screen at all: a control at the edge is only tapped from the side the screen has). */
async function takesFingertip(control: Locator): Promise<boolean> {
  return control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const onScreen = ([px, py]: number[]) => px! >= 0 && py! >= 0 && px! < innerWidth && py! < innerHeight;
    return [[x - 21, y], [x + 21, y], [x, y - 21], [x, y + 21]].filter(onScreen).every(([px, py]) => {
      const hit = document.elementFromPoint(px!, py!);
      return !!hit && (hit === element || element.contains(hit));
    });
  });
}

/** Waits until the dropped widget has glided into place, as a person would before the next tap. dnd-kit
 * swallows every click for 50 ms after a drop, so a click sent at once (a fast runner does) is ignored. */
async function dropSettled(page: Page) {
  await expect.poll(() => page.locator('[data-wall-widget]').evaluateAll((rows) => rows.some(
    (row) => (row as HTMLElement).style.transform !== '' || row.getAnimations({ subtree: true }).length > 0,
  ))).toBe(false);
}

/** A real finger drag (touch events through the DevTools protocol, as a phone sends them): the page
 * decides between scrolling and dragging exactly as it would under a finger. */
async function touchDrag(page: Page, from: { x: number; y: number }, toY: number) {
  const cdp = await page.context().newCDPSession(page);
  // A finger stops before it lets go. Lifting while still moving (the speed Chrome reads from when each event
  // arrives, so it depends on the runner) starts a fling, and Chrome drops the next tap that stops it: the
  // Save tap after the drag sent no click. Explicit timestamps keep the speed the same on any machine.
  let time = Date.now() / 1000;
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: { x: number; y: number }[], afterMs: number) => {
    time += afterMs / 1000;
    return cdp.send('Input.dispatchTouchEvent', { type, touchPoints, timestamp: time });
  };
  await send('touchStart', [from], 0);
  const steps = 12;
  const stepMs = Math.abs(toY - from.y) / steps;
  for (let step = 1; step <= steps; step++) {
    await send('touchMove', [{ x: from.x, y: from.y + ((toY - from.y) * step) / steps }], stepMs);
  }
  await send('touchMove', [{ x: from.x, y: toY }], 200);
  await send('touchEnd', [], 16);
  await cdp.detach();
}

test.describe('profile on a phone', () => {
  const game = (igdbId: number) => ({ igdbId, name: `Game ${igdbId}`, slug: `game-${igdbId}`, coverImageId: null, releaseYear: 2001 });

  test('the profile fills the screen and the Wall is edited with a finger alone', async ({ users }) => {
    const alice = await users.create('alice', { device: 'phone' });
    const saved = await alice.api.put('/api/me/wall', { data: {
      widgets: [{ connectionId: null, type: 'igdb-favorite-game' }, { connectionId: null, type: 'igdb-liked-games' }],
      games: { favorite: [game(9)], liked: [game(1), game(2)] },
    } });
    expect(saved.status()).toBe(200);
    const a = await alice.app();
    const page = a.page;
    await page.goto('/app/profile');
    await page.getByRole('button', { name: 'Meu perfil' }).filter({ hasText: 'Meu perfil' }).tap();

    const dialog = page.getByRole('dialog', { name: /^Perfil de / });
    await expect(dialog).toBeVisible();
    // once the opening animation is over
    await expect.poll(() => dialog.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });

    await dialog.getByRole('button', { name: 'Adicionar widget' }).tap();
    const catalog = page.getByRole('dialog', { name: 'Adicionar widget de perfil' });
    await catalog.getByRole('group', { name: 'Integrações' }).getByRole('button', { name: 'GitHub' }).tap();
    await expect(catalog.getByRole('region', { name: 'GitHub' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(catalog).toBeHidden();

    // a cover is one button that opens its actions: no invisible control over it to remove the game by accident
    const cover = page.getByRole('button', { name: 'Opções de Game 1' });
    await expect(page.getByRole('button', { name: 'Remover Game 1' })).toHaveCount(0);
    await cover.tap();
    await page.getByRole('menuitem', { name: 'Mover para depois' }).tap();
    await expect(page.getByRole('button', { name: /^Opções de Game / })).toHaveText(['Game 9', 'Game 2', 'Game 1']);

    // the controls beside a widget are drawn small but take a fingertip
    const first = page.getByRole('article').filter({ hasText: 'Jogo favorito' });
    await first.evaluate((article) => article.scrollIntoView({ block: 'start' }));
    const handle = page.getByRole('button', { name: 'Reordenar Jogos que eu gosto' });
    expect(await takesFingertip(handle)).toBe(true);
    expect(await takesFingertip(page.getByRole('button', { name: 'Opções de Jogos que eu gosto' }))).toBe(true);

    // a finger on the handle drags the widget instead of scrolling the profile
    const from = (await handle.boundingBox())!;
    const above = (await first.boundingBox())!;
    await touchDrag(page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, above.y + 5);
    await expect(page.getByRole('article').getByRole('heading', { level: 3 })).toHaveText(['Jogos que eu gosto', 'Jogo favorito']);
    await dropSettled(page);

    // the save bar's buttons take a fingertip too, and nothing is published before them
    const bar = page.getByRole('region', { name: 'Salvar alterações do Mural' });
    expect(await takesFingertip(bar.getByRole('button', { name: 'Salvar' }))).toBe(true);
    await bar.getByRole('button', { name: 'Salvar' }).tap();
    await expect(bar).toBeHidden();
    const wall = await (await alice.api.get(`/api/users/${alice.id}/wall`)).json() as { widgets: { type: string; data: { items: { name: string }[] } }[] };
    expect(wall.widgets.map((widget) => widget.type)).toEqual(['igdb-liked-games', 'igdb-favorite-game']);
    expect(wall.widgets[0]!.data.items.map((item) => item.name)).toEqual(['Game 2', 'Game 1']);
  });

  test('the colour picker is sized for a finger and its hex field does not make iOS zoom', async ({ users }) => {
    const alice = await users.create('alice', { device: 'phone' });
    const a = await alice.app();
    await a.page.goto('/app/profile');
    await a.page.getByRole('button', { name: 'Meu perfil' }).filter({ hasText: 'Meu perfil' }).tap();
    await a.page.getByRole('button', { name: /^Cor do perfil: / }).tap();

    const hue = a.page.getByRole('slider', { name: 'Matiz' });
    // polled: the popover opens with a zoom, and a bar measured mid-animation is still scaled down
    await expect.poll(() => takesFingertip(hue)).toBe(true);
    for (const swatch of await a.page.getByRole('button', { name: /^Usar / }).all()) {
      expect((await swatch.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    }
    // iOS zooms the whole page into a field whose text is under 16px
    expect(await a.page.getByLabel('Código hexadecimal da cor').evaluate((input) => getComputedStyle(input).fontSize)).toBe('16px');

    await a.page.getByRole('button', { name: 'Usar Verde', exact: true }).tap();
    await expect(a.page.getByRole('button', { name: 'Cor do perfil: Verde', exact: true })).toBeVisible();
  });
});

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
    await expect(a.page.getByText('1 amigo em comum').first()).toBeVisible();
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
    await a.page.getByRole('dialog', { name: 'Adicionar widget de perfil' }).getByRole('button', { name: 'Jogo favorito' }).click();
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

/** A real finger drag (touch events through the DevTools protocol, as a phone sends them): the page
 * decides between scrolling and dragging exactly as it would under a finger. */
async function touchDrag(page: Page, from: { x: number; y: number }, toY: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  const steps = 12;
  for (let step = 1; step <= steps; step++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + ((toY - from.y) * step) / steps }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
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

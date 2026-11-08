import { test, expect } from '../../fixtures/test';
import { befriend } from '../../fixtures/api';

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
    await a.page.getByRole('button', { name: 'Salvar perfil' }).click();
    await expect(a.page.getByText('Perfil salvo.')).toBeVisible();

    // Bob still has the DM open: the new name reaches him without a reload
    await expect(b.page.getByText('Alice Testes').first()).toBeVisible();
    const profile = await (await bob.api.get(`/api/users/${alice.id}/profile`)).json() as { user?: { bio?: string }; bio?: string };
    expect(profile.user?.bio ?? profile.bio).toBe('bio escrita pelo teste');
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
    expect(wall.widgets[0]!.data.items[0]!.imageUrl).toBe('https://images.igdb.com/igdb/image/upload/t_cover_big/co1abc.jpg');
  });
});

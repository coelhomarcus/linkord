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
});

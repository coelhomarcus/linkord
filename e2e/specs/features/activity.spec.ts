import { test, expect } from '../../fixtures/test';
import { fakeDesktop, setDesktopActivity } from '../../fixtures/activity';
import { befriend } from '../../fixtures/api';

test.describe('activity', () => {
  test("a friend's profile shows what they play now, with its timer, and what they played before", async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    await befriend(alice, bob);
    await fakeDesktop(bob.context);
    const b = await bob.app();

    const play = (key: string, name: string, minutesAgo: number) =>
      setDesktopActivity(b.page, { key, name, kind: 'playing', startedAt: Date.now() - minutesAgo * 60_000 });
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

test('publishes ranked activity and the calendar from the desktop history', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  await befriend(alice, bob);
  await fakeDesktop(alice.context);
  const a = await alice.app();
  await a.page.goto('/app/profile');
  await a.page.getByRole('button', { name: 'Meu perfil' }).filter({ hasText: 'Meu perfil' }).click();
  await a.page.getByRole('tab', { name: 'Mural' }).click();
  const add = a.page.getByRole('button', { name: 'Adicionar widget' });
  const catalog = a.page.getByRole('dialog', { name: 'Adicionar widget de perfil' });
  for (const name of ['Mais jogados', 'Calendário de atividade']) {
    await add.click();
    await catalog.getByRole('navigation').getByRole('button', { name: 'Atividade', exact: true }).click();
    await catalog.getByRole('button', { name }).click();
  }
  await expect(a.page.getByText('Nenhuma atividade ainda')).toHaveCount(2);
  await a.page.getByRole('combobox', { name: 'Período de Mais jogados' }).selectOption({ label: 'Últimos 7 dias' });
  const save = a.page.getByRole('region', { name: 'Salvar alterações do Mural' });
  await save.getByRole('button', { name: 'Salvar' }).click();
  await expect(save).toBeHidden();

  await setDesktopActivity(a.page, { key: 'spotify', name: 'Spotify', kind: 'using', startedAt: Date.now() - 3600_000 });
  await expect.poll(async () => {
    const result = await alice.api.get(`/api/users/${alice.id}/activity`);
    return (await result.json()).items.map((item: { key: string }) => item.key);
  }).toContain('spotify');
  await setDesktopActivity(a.page, null);

  const b = await bob.app();
  await b.page.goto('/app/friends');
  await b.page.getByRole('button', { name: `Ver perfil de ${alice.username}`, exact: true }).click();
  await b.page.getByRole('tab', { name: 'Mural' }).click();
  const top = b.page.getByRole('article').filter({ has: b.page.getByRole('heading', { name: 'Mais jogados' }) });
  await expect(top).toContainText('Spotify');
  await expect(top).toContainText('Últimos 7 dias');
  await expect(b.page.getByRole('group', { name: 'Calendário de atividade' }).getByRole('img', { name: /Menos de 1 min/ })).toBeAttached();
});

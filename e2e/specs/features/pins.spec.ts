import { test, expect, type User } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

async function twoInAChannel(users: { create(prefix?: string): Promise<User> }): Promise<{ a: AppPage; b: AppPage }> {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E pins');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);
  return { a, b };
}

test.describe('pinned and saved messages', () => {
  test('the owner pins, the member sees the notice and the dot, jumps to it, and the owner unpins', async ({ users }) => {
    const { a, b } = await twoInAChannel(users);
    await a.send('regras do canal');
    await b.expectMessage('regras do canal');

    await a.message('regras do canal').first().click({ button: 'right' });
    await a.page.getByRole('menuitem', { name: 'Fixar mensagem' }).click();
    await a.page.getByRole('button', { name: 'Fixar', exact: true }).click();

    await expect(b.page.getByText(/fixou uma mensagem neste canal/)).toBeVisible();
    const pins = b.page.getByRole('button', { name: 'Mensagens fixadas (novas)' });
    await expect(pins).toBeVisible();
    await pins.click();
    const popover = b.page.getByRole('dialog').filter({ hasText: 'Mensagens fixadas' });
    await expect(popover.getByText('regras do canal')).toBeVisible();
    await popover.getByText('regras do canal').hover();
    await popover.getByRole('button', { name: 'Ir para mensagem' }).click();
    await expect(b.page.getByRole('button', { name: 'Mensagens fixadas', exact: true })).toBeVisible();

    await a.page.getByRole('button', { name: 'Mensagens fixadas', exact: true }).click();
    const ownerPopover = a.page.getByRole('dialog').filter({ hasText: 'Mensagens fixadas' });
    await ownerPopover.getByText('regras do canal').hover();
    await ownerPopover.getByRole('button', { name: 'Desafixar' }).click({ modifiers: ['Shift'] });
    await a.page.keyboard.press('Escape');
    await b.page.getByRole('button', { name: 'Mensagens fixadas', exact: true }).click();
    await expect(b.page.getByText('Este canal não tem mensagens fixadas... por enquanto.')).toBeVisible();
  });

  test('a member without the permission is told how pinning works and is not offered it', async ({ users }) => {
    const { a, b } = await twoInAChannel(users);
    await a.send('mensagem comum');
    await b.expectMessage('mensagem comum');
    await b.message('mensagem comum').first().click({ button: 'right' });
    await expect(b.page.getByRole('menuitem', { name: 'Fixar mensagem' })).toHaveCount(0);
    await b.page.keyboard.press('Escape');
    await b.page.getByRole('button', { name: 'Mensagens fixadas', exact: true }).click();
    await expect(b.page.getByText(/permissão “Fixar mensagens”/)).toBeVisible();
  });

  test('a saved message shows in the inbox and leaves it when removed', async ({ users }) => {
    const { a, b } = await twoInAChannel(users);
    await a.send('para ler depois');
    await b.expectMessage('para ler depois');
    const row = b.message('para ler depois').first();
    await row.hover();
    await row.getByRole('button', { name: 'Salvar mensagem' }).click();
    await expect(row.getByRole('button', { name: 'Remover dos salvos' })).toBeVisible();

    await b.page.getByRole('button', { name: /^Caixa de Entrada/ }).click();
    await b.page.getByRole('tab', { name: 'Salvas' }).click();
    const saved = b.page.getByRole('dialog').getByText('para ler depois');
    await expect(saved).toBeVisible();
    await saved.hover();
    await b.page.getByRole('dialog').getByRole('button', { name: 'Remover' }).click();
    await expect(b.page.getByText('Nenhuma mensagem salva')).toBeVisible();
  });
});

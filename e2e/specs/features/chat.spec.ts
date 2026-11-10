import { writeFileSync } from 'node:fs';
import { test, expect, type User } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';

// a 1x1 PNG, enough for the image path (thumbnail, preview) without a fixture file
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function twoInAChannel(users: { create(prefix?: string): Promise<User> }): Promise<{ alice: User; bob: User; a: AppPage; b: AppPage }> {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E chat');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);
  return { alice, bob, a, b };
}

/** Hovers a message so its action bar shows, then clicks one of its buttons.
 * The first match: a reply also shows the text it quotes. */
async function messageAction(app: AppPage, text: string, action: string): Promise<void> {
  const row = app.message(text).first();
  await row.hover();
  await row.getByRole('button', { name: action }).click();
}

test.describe('chat', () => {
  test('two members talk in a text channel, each message shown once', async ({ users }) => {
    const { a, b } = await twoInAChannel(users);
    await a.send('olá do lado da alice');
    await b.expectMessage('olá do lado da alice');
    await a.expectMessage('olá do lado da alice');
    await b.send('oi alice, aqui é o bob');
    await a.expectMessage('oi alice, aqui é o bob');
  });

  test('typing shows on the other side', async ({ users }) => {
    const { alice, a, b } = await twoInAChannel(users);
    await a.composer().click();
    await a.composer().pressSequentially('escrevendo devagar', { delay: 50 });
    await expect(b.page.getByText(`${alice.username} está digitando...`)).toBeVisible();
  });

  test('reply, edit and delete are seen by the other member', async ({ users }) => {
    const { a, b } = await twoInAChannel(users);
    await a.send('mensagem original');
    await b.expectMessage('mensagem original');

    await messageAction(b, 'mensagem original', 'Responder');
    await expect(b.page.getByText('Respondendo a')).toBeVisible();
    await b.send('esta é a resposta');
    await expect(a.message('esta é a resposta').getByText('mensagem original')).toBeVisible();

    await messageAction(a, 'mensagem original', 'Editar');
    const editor = a.message('mensagem original').first().getByRole('textbox');
    await editor.fill('mensagem editada');
    // the row no longer matches "mensagem original" once the text changes
    await a.page.keyboard.press('Enter');
    await b.expectMessage('mensagem editada');

    await messageAction(a, 'mensagem editada', 'Apagar');
    await a.page.getByRole('button', { name: 'Apagar', exact: true }).last().click();
    await expect(b.page.locator('[data-message-id]').filter({ hasText: /^mensagem editada/ })).toHaveCount(0);
  });

  test('@everyone notifies only when its author may: picked from the list by the owner, plain text from a member', async ({ users }) => {
    const { bob, a, b } = await twoInAChannel(users);
    const mentionCount = async () => {
      const body = await (await bob.api.get('/api/notifications')).json() as { items: { kind: string }[] };
      return body.items.filter((item) => item.kind === 'mention').length;
    };

    // a member without the permission is not offered it, and typing it notifies nobody
    await b.composer().click();
    await b.composer().pressSequentially('@ev');
    await expect(b.page.getByRole('button', { name: /^@everyone/ })).toHaveCount(0);
    await b.composer().fill('@everyone sem permissão');
    await b.composer().press('Enter');
    await a.expectMessage('@everyone sem permissão');
    await expect(a.message('@everyone sem permissão').locator('span.rounded-sm', { hasText: '@everyone' })).toHaveCount(0);

    // the owner holds it: the list offers @everyone, and the member is notified
    await a.composer().click();
    await a.composer().pressSequentially('@ev');
    await a.page.getByRole('button', { name: /^@everyone/ }).click();
    await a.composer().pressSequentially('reunião agora');
    await a.composer().press('Enter');
    await b.expectMessage('@everyone reunião agora');
    await expect(b.message('@everyone reunião agora').locator('span.rounded-sm', { hasText: '@everyone' })).toBeVisible();
    await expect.poll(mentionCount).toBe(1);
  });

  test('a reaction appears for the other member and can be removed', async ({ users }) => {
    const { a, b } = await twoInAChannel(users);
    await a.send('reaja aqui');
    await b.expectMessage('reaja aqui');

    await messageAction(b, 'reaja aqui', 'Reagir');
    await b.page.getByRole('button', { name: 'Reagir com 👍' }).click();
    const chip = a.message('reaja aqui').getByRole('button', { name: /reação 👍 \(1\)/ });
    await expect(chip).toBeVisible();

    await b.message('reaja aqui').getByRole('button', { name: /^Remover reação 👍/ }).click();
    await expect(chip).toHaveCount(0);
  });

  test('search finds a message by its words', async ({ users }) => {
    const { a, b } = await twoInAChannel(users);
    const word = `palavra${Date.now() % 100000}`;
    await b.send(`tem uma ${word} escondida aqui`);
    await a.expectMessage(`tem uma ${word} escondida aqui`);

    await a.page.getByRole('button', { name: 'Buscar' }).first().click();
    await a.page.getByPlaceholder('Buscar mensagens...').fill(word);
    await a.page.getByPlaceholder('Buscar mensagens...').press('Enter');
    await expect(a.page.getByRole('dialog').getByText(word)).toBeVisible();
  });

  test('an image attachment reaches the other member', async ({ users }, testInfo) => {
    const { a, b } = await twoInAChannel(users);
    const file = testInfo.outputPath('pixel.png');
    writeFileSync(file, PNG);
    await a.page.locator('input[type=file]:not([accept])').setInputFiles(file);
    await a.send('com imagem');
    await expect(b.message('com imagem').locator('img').first()).toBeVisible();
  });
});

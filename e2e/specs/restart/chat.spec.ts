import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import type { AppPage } from '../../fixtures/app';
import { deploy, sql, startApp, stopApp } from '../../stack/stack';

async function expectDeliveredOnce(sender: AppPage, recipient: AppPage, conversationId: string, text: string): Promise<void> {
  const storedCount = () => sql(`SELECT count(*) FROM messages WHERE conversation_id = '${conversationId}' AND text = '${text}'`);
  await test.step('The message is stored exactly once in PostgreSQL', async () => {
    await expect.poll(storedCount).toBe('1');
  });
  await test.step('The stored message appears once for both participants', async () => {
    await Promise.all([
      expect(sender.message(text), 'The sender should see the stored message exactly once').toHaveCount(1),
      expect(recipient.message(text), 'The recipient should see the stored message exactly once').toHaveCount(1),
    ]);
  });
  expect(storedCount(), 'The message should still have exactly one row after delivery').toBe('1');
}

test.describe('messages across a redeploy', () => {
  test('a message written while the server is down is delivered once it is back, once', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E chat down');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const a = await alice.app();
    const b = await bob.app();
    await a.openChannel(server.id, server.text.id);
    await b.openChannel(server.id, server.text.id);

    stopApp();
    const text = `escrita com o servidor fora ${Date.now()}`;
    await a.send(text);
    await expect(a.page.getByText(text)).toBeVisible(); // the pending copy
    await startApp();

    await expectDeliveredOnce(a, b, server.text.id, text);
  });

  test('a message sent right as the redeploy starts is stored and shown once', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E chat deploy');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));
    const a = await alice.app();
    const b = await bob.app();
    await a.openChannel(server.id, server.text.id);
    await b.openChannel(server.id, server.text.id);

    const text = `no instante do deploy ${Date.now()}`;
    const deploying = deploy();
    await a.send(text);
    await deploying;

    await expectDeliveredOnce(a, b, server.text.id, text);
  });
});

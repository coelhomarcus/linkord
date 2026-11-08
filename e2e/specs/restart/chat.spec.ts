import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { deploy, sql, startApp, stopApp } from '../../stack/stack';

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

    await a.expectMessage(text);
    await b.expectMessage(text);
    expect(sql(`SELECT count(*) FROM messages WHERE text = '${text}'`)).toBe('1');
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

    await a.expectMessage(text);
    await b.expectMessage(text);
    expect(sql(`SELECT count(*) FROM messages WHERE text = '${text}'`)).toBe('1');
  });
});

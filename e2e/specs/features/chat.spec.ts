import { test } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';

test.describe('chat', () => {
  test('two members of a server talk in a text channel, each message shown once', async ({ users }) => {
    const alice = await users.create('alice');
    const bob = await users.create('bob');
    const server = await createServer(alice.api, 'E2E chat');
    await acceptInvite(bob.api, await createInvite(alice.api, server.id));

    const a = await alice.app();
    const b = await bob.app();
    await a.openChannel(server.id, server.text.id);
    await b.openChannel(server.id, server.text.id);

    await a.send('olá do lado da alice');
    await b.expectMessage('olá do lado da alice');
    await a.expectMessage('olá do lado da alice');

    await b.send('oi alice, aqui é o bob');
    await a.expectMessage('oi alice, aqui é o bob');
  });
});

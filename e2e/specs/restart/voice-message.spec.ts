import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { sql, startApp, stopApp } from '../../stack/stack';

// A voice message is an ordinary attachment in the outbox: recording is local,
// and the upload waits out the outage like any other file.
test('a voice message sent while the server is down arrives once it is back, once', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E voice message down');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));
  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);

  await a.page.getByRole('button', { name: 'Gravar mensagem de voz' }).click();
  await expect(a.page.getByRole('timer')).toHaveText('0:02');
  stopApp();
  await a.page.getByRole('button', { name: 'Parar e revisar' }).click();
  await a.page.getByRole('button', { name: 'Enviar mensagem de voz' }).click();
  await startApp();

  await expect(b.page.getByRole('group', { name: /^Mensagem de voz, 0:0\d$/ })).toBeVisible();
  await expect(a.page.getByRole('group', { name: /^Mensagem de voz, 0:0\d$/ })).toHaveCount(1);
  expect(sql(`SELECT count(*) FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.conversation_id = '${server.text.id}' AND a.voice_duration_ms IS NOT NULL`)).toBe('1');
});

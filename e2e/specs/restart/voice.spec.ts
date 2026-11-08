import { test, expect } from '../../fixtures/test';
import { acceptInvite, createInvite, createServer } from '../../fixtures/api';
import { deploy } from '../../stack/stack';

// A redeploy must look like a short network drop to a voice call: the media
// stays on LiveKit, the server restores who is in the call, every tab
// reconnects on its own (even one nobody is looking at), and someone who
// joins after the deploy lands in the same call. See AGENTS.md, "Realtime
// compatibility and deploys".
test('a voice call survives a redeploy, and a newcomer joins the same call', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E voice restart');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));

  const a = await alice.app();
  await a.openChannel(server.id, server.text.id);
  await a.joinVoice(server.voice.name);
  await a.expectTilesFor([alice.username]);

  await deploy();

  const b = await bob.app();
  await b.openChannel(server.id, server.text.id);
  await b.joinVoice(server.voice.name);

  // Alice's tab was never focused again: it has to come back by itself
  await a.expectTilesFor([alice.username, bob.username]);
  await b.expectTilesFor([alice.username, bob.username]);
  await a.expectRemoteAudio(1);
  await b.expectRemoteAudio(1);
  expect(a.socketDisconnects, 'the shutdown must drop the transport, not send a disconnect').not.toContain('io server disconnect');
});

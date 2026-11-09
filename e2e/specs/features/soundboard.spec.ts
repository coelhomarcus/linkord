import { test, expect } from '../../fixtures/test';
import { PERMISSIONS, acceptInvite, createInvite, createServer, grantEveryone } from '../../fixtures/api';

/** One second of a 440 Hz tone as a 16-bit mono WAV: a real, short, valid sound. */
function toneWav(seconds = 1, sampleRate = 22_050): Buffer {
  const samples = seconds * sampleRate;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000), i * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

test('a sound uploaded to the server plays for everyone in the call', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E soundboard');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));

  const uploaded = await alice.api.post(`/api/servers/${server.id}/sounds?name=${encodeURIComponent('buzina')}&volume=100`, {
    headers: { 'Content-Type': 'audio/wav' }, data: toneWav(),
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);

  const a = await alice.app();
  const b = await bob.app();
  await a.openChannel(server.id, server.text.id);
  await b.openChannel(server.id, server.text.id);
  await a.joinVoice(server.voice.name);
  await b.joinVoice(server.voice.name);

  const heard = b.waitForSocketEvent('soundboard-play');
  await a.page.getByRole('button', { name: 'Efeitos sonoros' }).first().click();
  await a.page.getByRole('button', { name: 'Tocar buzina' }).click();
  await heard;
});

test('a member adds a sound from the call when @everyone may, and only then', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E add sound');
  await acceptInvite(bob.api, await createInvite(alice.api, server.id));

  const b = await bob.app();
  await b.openChannel(server.id, server.text.id);
  await b.joinVoice(server.voice.name);
  const picker = b.page.getByRole('button', { name: 'Efeitos sonoros' }).first();

  // a new server keeps adding sounds to whoever is given CREATE_EXPRESSIONS
  await picker.click();
  await expect(b.page.getByText('Este servidor ainda não tem sons.')).toBeVisible();
  await expect(b.page.getByRole('button', { name: 'Adicionar som' })).toHaveCount(0);
  await b.page.keyboard.press('Escape');

  await grantEveryone(alice.api, server, PERMISSIONS.CREATE_EXPRESSIONS);
  await picker.click();
  await b.page.getByRole('button', { name: 'Adicionar som' }).click();
  const editor = b.page.getByRole('dialog', { name: 'Enviar um som' });
  await editor.getByLabel('Arquivo').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: toneWav() });
  await editor.getByLabel('Nome do som').fill('apito');
  await editor.getByRole('button', { name: 'Enviar' }).click();
  await expect(editor).toHaveCount(0);

  await picker.click();
  await expect(b.page.getByRole('button', { name: 'Tocar apito' })).toBeVisible();
});

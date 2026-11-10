import { deflateSync } from 'node:zlib';
import { test, expect } from '../../fixtures/test';
import { acceptInvite, befriend, createInvite, createServer } from '../../fixtures/api';

/** A solid square PNG, built by hand: a real image for the server to convert. */
function squarePng(size = 64): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6; // 8-bit RGBA
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 4, 0)]);
  for (let x = 0; x < size; x++) row.set([255, 170, 0, 255], 1 + x * 4);
  const pixels = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

test(':shortcode: suggestions insert an emoji, and a full shortcode turns into one', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  await befriend(alice, bob);
  const a = await alice.app();
  await a.openDmWith(bob.username);

  const composer = a.composer();
  await composer.click();
  await composer.pressSequentially('rindo :lau');
  const list = a.page.getByRole('listbox', { name: 'Sugestões de emoji' });
  await expect(list.getByRole('option', { name: /:laughing:/ })).toBeVisible();
  await composer.press('Enter');
  await composer.pressSequentially('e :joy:');
  await expect(composer).toHaveText('rindo 😆 e 😂');
  await composer.press('Enter');
  await a.expectMessage('rindo 😆 e 😂');
});

test('a server emoji goes into a DM with someone outside the server, who sees the picture', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const carol = await users.create('carol');
  const server = await createServer(alice.api, 'E2E emojis');
  const uploaded = await alice.api.post(`/api/servers/${server.id}/emojis?name=e2e_sun`, { headers: { 'Content-Type': 'image/png' }, data: squarePng() });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const { emoji } = await uploaded.json() as { emoji: { id: string } };

  // bob is not in alice's server; carol is in another one of hers
  await befriend(alice, bob);
  const other = await createServer(alice.api, 'E2E elsewhere');
  await acceptInvite(carol.api, await createInvite(alice.api, other.id));

  const a = await alice.app();
  const b = await bob.app();
  const dm = await a.openDmWith(bob.username);

  // picked from the emoji picker's section for that server
  await a.page.getByRole('button', { name: 'Inserir emoji' }).click();
  await a.page.getByRole('gridcell', { name: ':e2e_sun:' }).first().click();
  // drawn in the field as the picture it is sent as
  await expect(a.composer().getByRole('img', { name: ':e2e_sun:' })).toBeVisible();
  await a.composer().press('Enter');
  await a.expectMessage(':e2e_sun:', 0);

  // the DM reaches bob with its first message
  await b.openDm(dm);
  const picture = b.page.locator('[data-message-id]').getByRole('img', { name: ':e2e_sun:' });
  await expect(picture).toBeVisible();
  await expect(picture).toHaveAttribute('src', `/api/emojis/${emoji.id}`);
  await expect.poll(() => picture.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(128);

  // and in another server's channel, typed in full
  const c = await carol.app();
  await a.openChannel(other.id, other.text.id);
  await c.openChannel(other.id, other.text.id);
  await a.send('bom dia :e2e_sun:');
  await expect(c.page.locator('[data-message-id]').getByRole('img', { name: ':e2e_sun:' })).toBeVisible();
});

test('an admin uploads and crops an emoji from the server settings', async ({ users }) => {
  const alice = await users.create('alice');
  const server = await createServer(alice.api, 'E2E emoji upload');
  const a = await alice.app();
  await a.openChannel(server.id, server.text.id);

  // the header's menu button, not the rail icon of the same name
  await a.page.getByRole('button', { name: 'E2E emoji upload', exact: true, expanded: false }).click();
  await a.page.getByRole('menuitem', { name: 'Configurações do servidor' }).click();
  await a.page.getByRole('button', { name: 'Emojis', exact: true }).click();
  const chooser = a.page.waitForEvent('filechooser');
  await a.page.getByRole('button', { name: 'Enviar emoji' }).click();
  await (await chooser).setFiles({ name: 'Sol Nascente.png', mimeType: 'image/png', buffer: squarePng(200) });
  const crop = a.page.getByRole('dialog', { name: 'Recortar emoji' });
  await crop.getByRole('button', { name: 'Salvar' }).click();
  await expect(crop).toHaveCount(0);
  await expect(a.page.getByRole('img', { name: ':sol_nascente:' })).toBeVisible();
});

test('the message box draws emojis as they are typed and edits them as one character', async ({ users }) => {
  const alice = await users.create('alice');
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E emoji field');
  const uploaded = await alice.api.post(`/api/servers/${server.id}/emojis?name=e2e_moon`, { headers: { 'Content-Type': 'image/png' }, data: squarePng() });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  await befriend(alice, bob);
  const a = await alice.app();
  await a.openDmWith(bob.username);

  const composer = a.composer();
  await composer.click();
  await composer.pressSequentially('lua :e2e_moon: 🎉', { delay: 20 });
  await expect(composer.getByRole('img', { name: ':e2e_moon:' })).toBeVisible();
  await expect(composer.locator('[data-emoji]')).toHaveText('🎉');

  // Backspace takes the Twemoji, then the space, then the server emoji, each whole
  await composer.press('Backspace');
  await composer.press('Backspace');
  await composer.press('Backspace');
  await expect(composer.getByRole('img', { name: ':e2e_moon:' })).toHaveCount(0);
  await expect(composer).toHaveText('lua ');

  // emptied with select-all, it takes typing again at once
  await composer.press('ControlOrMeta+a');
  await composer.press('Backspace');
  await composer.pressSequentially('de novo', { delay: 20 });
  await expect(composer).toHaveText('de novo');
  await composer.press('Enter');
  await a.expectMessage('de novo');
});

test('on a touch phone, the message box takes typing with emojis and sends it', async ({ users }) => {
  const alice = await users.create('alice', { device: 'phone' });
  const bob = await users.create('bob');
  const server = await createServer(alice.api, 'E2E emoji phone');
  const uploaded = await alice.api.post(`/api/servers/${server.id}/emojis?name=e2e_star`, { headers: { 'Content-Type': 'image/png' }, data: squarePng() });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  await befriend(alice, bob);
  const a = await alice.app();
  const dm = await a.openDmWith(bob.username);

  const composer = a.composer();
  await composer.tap();
  await composer.pressSequentially('do celular :e2e_star: 🍕', { delay: 20 });
  await expect(composer.getByRole('img', { name: ':e2e_star:' })).toBeVisible();
  await a.page.getByRole('button', { name: 'Enviar mensagem' }).tap();
  await expect(composer).toHaveText('');

  const b = await bob.app();
  await b.openDm(dm);
  const sent = b.message('do celular');
  await expect(sent.getByRole('img', { name: ':e2e_star:' })).toBeVisible();
  await expect(sent.locator('[data-emoji]')).toHaveText('🍕');
});

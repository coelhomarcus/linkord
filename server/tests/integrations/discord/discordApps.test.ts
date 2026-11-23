import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConnectionFetchError, type RequestJson } from '../../../src/integrations/connectionHttp.js';
import { createDiscordAppClient, isDiscordAppId } from '../../../src/integrations/discord/discordApps.js';

const APP = '1234567890123456789';
const HASH = 'f'.repeat(32);

function fake(answer: (url: string) => unknown) {
  const calls: string[] = [];
  const request: RequestJson = async (url) => {
    calls.push(url);
    const value = answer(url);
    if (value instanceof Error) throw value;
    return value;
  };
  return { request, calls };
}

function clock(start = 1_000_000) {
  let at = start;
  return { now: () => at, advance: (ms: number) => { at += ms; } };
}

describe('Discord application API adapter', () => {
  it('reads the name and icon of an application, without credentials', async () => {
    const api = fake(() => ({ id: APP, name: ' Some\u0000 Game ', icon: HASH, description: '' }));
    const client = createDiscordAppClient({ request: api.request });
    assert.deepEqual(await client.app(APP), { name: 'Some Game', icon: `https://cdn.discordapp.com/app-icons/${APP}/${HASH}.png?size=256` });
    assert.deepEqual(api.calls, [`https://discord.com/api/v10/applications/${APP}/rpc`]);
  });

  it('refuses ids that are not snowflakes without asking, and icon hashes that are not hashes', async () => {
    const api = fake(() => ({ name: 'Game', icon: '../x' }));
    const client = createDiscordAppClient({ request: api.request });
    for (const id of ['123', 'a'.repeat(18), `${APP}/../x`, '1'.repeat(21)]) {
      assert.equal(isDiscordAppId(id), false);
      assert.equal(await client.app(id), null);
      assert.equal((await client.assets(id)).size, 0);
    }
    assert.equal(api.calls.length, 0);
    assert.deepEqual(await client.app(APP), { name: 'Game', icon: null });
  });

  it('maps asset names (lowercase) and ids to their pictures', async () => {
    const api = fake(() => [{ id: '111111111111111111', type: 1, name: 'Logo_Large' }, { id: 'bad', name: 'x' }, null, { id: '222222222222222222', name: 'map' }]);
    const client = createDiscordAppClient({ request: api.request });
    const assets = await client.assets(APP);
    assert.equal(assets.get('logo_large'), `https://cdn.discordapp.com/app-assets/${APP}/111111111111111111.png`);
    assert.equal(assets.get('111111111111111111'), `https://cdn.discordapp.com/app-assets/${APP}/111111111111111111.png`);
    assert.equal(assets.get('map'), `https://cdn.discordapp.com/app-assets/${APP}/222222222222222222.png`);
    assert.equal(assets.has('x'), false);
    assert.deepEqual(api.calls, [`https://discord.com/api/v10/oauth2/applications/${APP}/assets`]);
  });

  it('remembers answers for a day, "not found" included, and shares requests in flight', async () => {
    const time = clock();
    const api = fake((url) => (url.includes('/rpc') ? new ConnectionFetchError('not_found') : []));
    const client = createDiscordAppClient({ request: api.request, now: time.now });
    const [a, b] = await Promise.all([client.app(APP), client.app(APP)]);
    assert.equal(a, null);
    assert.equal(b, null);
    time.advance(23 * 60 * 60 * 1000);
    await client.app(APP);
    assert.equal(api.calls.length, 1);
    time.advance(2 * 60 * 60 * 1000);
    await client.app(APP);
    assert.equal(api.calls.length, 2);
  });

  it('asks again after a few minutes when Discord failed, or after its Retry-After', async () => {
    const time = clock();
    let failure: Error | null = new ConnectionFetchError('unavailable');
    const api = fake(() => failure ?? { name: 'Game', icon: null });
    const client = createDiscordAppClient({ request: api.request, now: time.now });
    assert.equal(await client.app(APP), null);
    time.advance(60_000);
    assert.equal(await client.app(APP), null);
    assert.equal(api.calls.length, 1);
    time.advance(5 * 60_000);
    failure = new ConnectionFetchError('rate_limited', 30 * 60_000);
    assert.equal(await client.app(APP), null);
    assert.equal(api.calls.length, 2);
    failure = null;
    time.advance(10 * 60_000);
    assert.equal(await client.app(APP), null);
    time.advance(21 * 60_000);
    assert.deepEqual(await client.app(APP), { name: 'Game', icon: null });
    assert.equal(api.calls.length, 3);
  });

  it('treats an unreadable answer as a failure', async () => {
    const client = createDiscordAppClient({ request: fake(() => 'nope').request });
    assert.equal(await client.app(APP), null);
    assert.equal((await createDiscordAppClient({ request: fake(() => ({ not: 'a list' })).request }).assets(APP)).size, 0);
  });
});

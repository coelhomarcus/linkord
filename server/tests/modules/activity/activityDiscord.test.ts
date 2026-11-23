import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import type { DiscordAppClient } from '../../../src/integrations/discord/discordApps.js';
import {
  createDiscordActivityHandler, createDiscordActivityLookup, imageSource, parseDiscordActivityBody, type ImageSource,
} from '../../../src/modules/activity/activityDiscord.js';

const APP = '1234567890123456789';
const ICON_URL = `https://cdn.discordapp.com/app-icons/${APP}/${'f'.repeat(32)}.png?size=256`;
const ASSET_URL = `https://cdn.discordapp.com/app-assets/${APP}/111111111111111111.png`;
const assets = new Map([['logo', ASSET_URL], ['111111111111111111', ASSET_URL]]);

function setup(options: { app?: { name: string; icon: string | null } | null; failing?: string[]; now?: () => number } = {}) {
  const calls: string[] = [];
  const downloads: ImageSource[] = [];
  const client: DiscordAppClient = {
    async app(id) { calls.push(`app:${id}`); return options.app === undefined ? { name: 'Some Game', icon: ICON_URL } : options.app; },
    async assets(id) { calls.push(`assets:${id}`); return assets; },
  };
  const lookup = createDiscordActivityLookup({
    client,
    async download(source) {
      downloads.push(source);
      if (options.failing?.includes(source.url)) throw new Error('unreachable');
      return Buffer.from(source.url);
    },
    // what is stored is named after where it came from
    storeIcon: async (bytes) => (bytes.toString().includes('not-a-picture') ? 'invalid_image' : { id: `id:${bytes.toString()}` }),
    now: options.now,
  });
  return { lookup, calls, downloads };
}

describe('parseDiscordActivityBody', () => {
  it('takes an application id and up to two images, once each', () => {
    assert.deepEqual(parseDiscordActivityBody({ appId: APP }), { appId: APP, images: [] });
    assert.deepEqual(parseDiscordActivityBody({ appId: APP, images: ['logo', 'logo'] }), { appId: APP, images: ['logo'] });
    for (const body of [null, [], { appId: 123 }, { appId: '12' }, { appId: APP, images: ['a', 'b', 'c'] }, { appId: APP, images: [''] }, { appId: APP, images: [1] }, { appId: APP, images: ['x'.repeat(1025)] }, { appId: APP, images: 'logo' }]) {
      assert.equal(parseDiscordActivityBody(body), null);
    }
  });
});

describe('imageSource', () => {
  it('reads asset keys, https links and Discord\'s external media', () => {
    assert.deepEqual(imageSource('LOGO', assets), { url: ASSET_URL, redirects: 0 });
    assert.deepEqual(imageSource('111111111111111111', assets), { url: ASSET_URL, redirects: 0 });
    assert.deepEqual(imageSource('https://example.com/a.png', assets), { url: 'https://example.com/a.png', redirects: 3 });
    assert.deepEqual(imageSource('mp:external/abc/https/example.com/a.png', assets), { url: 'https://media.discordapp.net/external/abc/https/example.com/a.png', redirects: 0 });
  });

  it('names nothing for unknown keys, other schemes or a path that climbs out', () => {
    for (const image of ['unknown', 'http://example.com/a.png', 'file:///etc/passwd', 'https://user:pw@example.com/a.png', 'mp:attachments/1/2/a.png', 'mp:external/../../api/x', 'mp:external/x@evil.example/a', '../logo']) {
      const source = imageSource(image, assets);
      assert.ok(source === null || (new URL(source.url).hostname === 'media.discordapp.net' && new URL(source.url).pathname.startsWith('/external/')), image);
    }
    assert.equal(imageSource('mp:external/../../api/x', assets), null);
    assert.equal(imageSource('unknown', assets), null);
    assert.equal(imageSource('http://example.com/a.png', assets), null);
  });
});

describe('Discord activity lookup', () => {
  it('answers the name, the stored icon and each stored image keyed by what was sent', async () => {
    const { lookup, downloads } = setup();
    assert.deepEqual(await lookup({ appId: APP, images: ['logo', 'https://example.com/a.png'] }), {
      name: 'Some Game', icon: `id:${ICON_URL}`, images: { logo: `id:${ASSET_URL}`, 'https://example.com/a.png': 'id:https://example.com/a.png' },
    });
    assert.deepEqual(downloads.map((d) => d.redirects), [0, 0, 3]);
  });

  it('does not ask for the assets when no image is named by key', async () => {
    const { lookup, calls } = setup();
    await lookup({ appId: APP, images: ['mp:external/x/a.png'] });
    await lookup({ appId: APP, images: [] });
    assert.deepEqual(calls, [`app:${APP}`, `app:${APP}`]);
  });

  it('answers nulls when Discord does not know the application or a picture fails', async () => {
    const { lookup } = setup({ app: null, failing: ['https://example.com/down.png'] });
    assert.deepEqual(await lookup({ appId: APP, images: ['https://example.com/down.png', 'https://example.com/not-a-picture.png'] }), {
      name: null, icon: null, images: { 'https://example.com/down.png': null, 'https://example.com/not-a-picture.png': null },
    });
  });

  it('downloads a picture once a day, and one that failed again after a while', async () => {
    let at = 0;
    const { lookup, downloads } = setup({ app: { name: 'Game', icon: null }, failing: ['https://example.com/down.png'], now: () => at });
    const request = { appId: APP, images: ['logo', 'https://example.com/down.png'] };
    await Promise.all([lookup(request), lookup(request)]);
    assert.equal(downloads.length, 2);
    at += 11 * 60_000;
    await lookup(request);
    assert.deepEqual(downloads.map((d) => d.url), [ASSET_URL, 'https://example.com/down.png', 'https://example.com/down.png']);
    at += 24 * 60 * 60_000;
    await lookup(request);
    assert.equal(downloads.length, 5);
  });
});

describe('POST /api/activity/discord', () => {
  let app: FastifyInstance;
  let signedIn = true;
  before(async () => {
    app = Fastify();
    const { lookup } = setup();
    app.post('/api/activity/discord', createDiscordActivityHandler({
      session: async (_request, reply) => {
        if (signedIn) return { userId: `user-${Math.random()}` };
        await reply.code(401).send({ error: { code: 'unauthenticated' } });
        return null;
      },
      lookup,
    }));
    await app.ready();
  });
  after(() => app.close());

  it('answers the lookup to a signed-in account', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/activity/discord', payload: { appId: APP, images: ['logo'] } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { name: 'Some Game', icon: `id:${ICON_URL}`, images: { logo: `id:${ASSET_URL}` } });
  });

  it('refuses a malformed body and a signed-out request', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/activity/discord', payload: { appId: 'nope' } });
    assert.equal(bad.statusCode, 400);
    assert.equal(bad.json().error.code, 'invalid_request');
    signedIn = false;
    const out = await app.inject({ method: 'POST', url: '/api/activity/discord', payload: { appId: APP } });
    signedIn = true;
    assert.equal(out.statusCode, 401);
  });

  it('limits each account to 30 lookups a minute', async () => {
    const limited = Fastify();
    const { lookup } = setup();
    limited.post('/api/activity/discord', createDiscordActivityHandler({ session: async () => ({ userId: 'one-account' }), lookup }));
    const send = () => limited.inject({ method: 'POST', url: '/api/activity/discord', payload: { appId: APP } });
    for (let i = 0; i < 30; i++) assert.equal((await send()).statusCode, 200);
    const refused = await send();
    assert.equal(refused.statusCode, 429);
    assert.ok(Number(refused.headers['retry-after']) >= 1);
    await limited.close();
  });
});

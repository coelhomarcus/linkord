import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { handleInternal, INTERNAL_PREFIX } from '../src/internal.js';
import { memorySkinStore, setSkinStore } from '../src/skins.js';
import { clearCombat, setExperienceStore } from '../src/combat.js';
import { memoryExperienceStore } from '../src/experience.js';
import { admit, clearRoster } from '../src/roster.js';
import { skinPng } from './fixtures.js';
// the app signs, this service checks: both ends of the same request
import { signInternalRequest } from '../../server/src/modules/playground/playgroundToken.js';

const SECRET = 'k'.repeat(32);

describe('internal routes', () => {
  let server: http.Server;
  let base = '';
  let skins: ReturnType<typeof memorySkinStore>;
  let experience: ReturnType<typeof memoryExperienceStore>;

  before(async () => {
    server = http.createServer((req, res) => void handleInternal(req, res, (req.url ?? '').split('?')[0]!, SECRET));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${INTERNAL_PREFIX}`;
  });

  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    clearRoster();
    clearCombat();
    skins = memorySkinStore();
    setSkinStore(skins);
    experience = memoryExperienceStore();
    setExperienceStore(experience);
  });

  const post = (route: string, body: object, signature = signInternalRequest(JSON.stringify(body), SECRET, Date.now())) =>
    fetch(`${base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-playground-signature': signature }, body: JSON.stringify(body) });

  test('refuses an unsigned, a wrongly signed or an old request', async () => {
    const body = { userIds: ['ana'] };
    assert.equal((await post('forget', body, '')).status, 401);
    assert.equal((await post('forget', body, signInternalRequest(JSON.stringify(body), 'x'.repeat(32), Date.now()))).status, 401);
    assert.equal((await post('forget', body, signInternalRequest(JSON.stringify(body), SECRET, Date.now() - 10 * 60_000))).status, 401);
    assert.equal((await post('forget', body, signInternalRequest(JSON.stringify({ userIds: ['bia'] }), SECRET, Date.now()))).status, 401);
  });

  test('forget drops the accounts\' skins and experience and closes their connections', async () => {
    await skins.set('ana', skinPng());
    await skins.set('bia', skinPng());
    await experience.add('play-1', 'ana', 20);
    let closed = false;
    admit({ id: 'c1', userId: 'ana', conversationId: 'play-1', expiresAt: Date.now() + 60_000, socket: { connected: true, emit: () => {}, disconnect: () => { closed = true; } } });
    assert.equal((await post('forget', { userIds: ['ana'] })).status, 200);
    assert.equal(await skins.get('ana'), null);
    assert.equal(await skins.get('bia'), skinPng());
    assert.equal(await experience.load('play-1', 'ana'), 0);
    assert.equal(closed, true);
  });

  test('import-skins keeps the valid ones', async () => {
    const updatedAt = new Date().toISOString();
    const response = await post('import-skins', { skins: [{ userId: 'ana', png: skinPng(), updatedAt }, { userId: 'bia', png: 'nope', updatedAt }] });
    assert.equal(response.status, 200);
    assert.equal(await skins.get('ana'), skinPng());
    assert.equal(skins.rows.has('bia'), false);
  });

  test('a malformed body is a 400, an unknown route a 404', async () => {
    assert.equal((await post('forget', { userIds: 'ana' })).status, 400);
    assert.equal((await post('nothing', {})).status, 404);
  });
});

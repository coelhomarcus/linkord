import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { cleanupParticipant, joinNew, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

async function asUser(userId: string) {
  const token = (await createSession(userId)).rawToken;
  return { cookie: `${config.SESSION_COOKIE}=${token}` };
}

async function me(headers: Record<string, string>) {
  return (await app.inject({ method: 'GET', url: '/api/auth/me', headers })).json().preferences;
}

describe('account preferences (real Postgres)', () => {
  it('reads null until the account syncs, then the stored values', async () => {
    const user = await makeUser('pref');
    const headers = await asUser(user.id);
    assert.equal(await me(headers), null);

    const res = await app.inject({ method: 'PATCH', url: '/api/me/preferences', headers, payload: { changes: { colorTheme: 'mocha' } } });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { preferences: { colorTheme: 'mocha' } });
    assert.deepEqual(await me(headers), { colorTheme: 'mocha' });
  });

  it('merges per key, clears with null and keeps accounts apart', async () => {
    const user = await makeUser('pref');
    const other = await makeUser('pref');
    const headers = await asUser(user.id);
    const otherHeaders = await asUser(other.id);
    const patch = (h: Record<string, string>, changes: object) => app.inject({ method: 'PATCH', url: '/api/me/preferences', headers: h, payload: { changes } });

    await patch(headers, { 'callVolume:a': 0.3, timeFormat: '12h' });
    await patch(headers, { 'callVolume:b': 0.6, timeFormat: null });
    await patch(otherHeaders, { 'sounds.call': false });
    assert.deepEqual(await me(headers), { 'callVolume:a': 0.3, 'callVolume:b': 0.6 });
    assert.deepEqual(await me(otherHeaders), { 'sounds.call': false });
  });

  it('tells every tab of the account what changed', async () => {
    const user = await makeUser('pref');
    const headers = await asUser(user.id);
    const tab = joinNew(user);
    try {
      await app.inject({ method: 'PATCH', url: '/api/me/preferences', headers, payload: { changes: { density: 'compact' } } });
      const told = tab.sent.filter((m) => m.payload?.t === 'my-preferences');
      assert.deepEqual(told.map((m) => m.payload.changes), [{ density: 'compact' }]);
    } finally {
      cleanupParticipant(tab.participant);
    }
  });

  it('seeds only an account that never synced', async () => {
    const user = await makeUser('pref');
    const headers = await asUser(user.id);
    const seed = (values: object) => app.inject({ method: 'POST', url: '/api/me/preferences/seed', headers, payload: { values } });

    const first = await seed({ colorTheme: 'latte', 'collapsed:s1': ['c1'] });
    assert.deepEqual(first.json(), { preferences: { colorTheme: 'latte', 'collapsed:s1': ['c1'] } });
    const second = await seed({ colorTheme: 'frappe' });
    assert.deepEqual(second.json(), { preferences: { colorTheme: 'latte', 'collapsed:s1': ['c1'] } });
    assert.deepEqual(await me(headers), { colorTheme: 'latte', 'collapsed:s1': ['c1'] });
  });

  it('refuses invalid changes without writing anything', async () => {
    const user = await makeUser('pref');
    const headers = await asUser(user.id);
    for (const payload of [{ changes: { colorTheme: 1 } }, { changes: { nope: true } }, { changes: 'x' }, {}]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/me/preferences', headers, payload });
      assert.equal(res.statusCode, 400, JSON.stringify(payload));
    }
    const seed = await app.inject({ method: 'POST', url: '/api/me/preferences/seed', headers, payload: { values: { font: null } } });
    assert.equal(seed.statusCode, 400);
    assert.equal(await me(headers), null);
  });

  it('requires a session', async () => {
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/me/preferences', payload: { changes: {} } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/me/preferences/seed', payload: { values: {} } })).statusCode, 401);
  });
});

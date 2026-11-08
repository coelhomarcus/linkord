import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { getPushShowContent } from '../../src/modules/notifications/notificationsRepository.js';
import { makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

async function asUser(userId: string) {
  const token = (await createSession(userId)).rawToken;
  return { cookie: `${config.SESSION_COOKIE}=${token}` };
}

describe('push notification content preference (real Postgres)', () => {
  it('shows message text by default and stores a change per account', async () => {
    const user = await makeUser('pc');
    const other = await makeUser('pc');
    const headers = await asUser(user.id);
    const first = await app.inject({ method: 'GET', url: '/api/notifications/push/preferences', headers });
    assert.deepEqual(first.json(), { showContent: true });

    const patch = await app.inject({ method: 'PATCH', url: '/api/notifications/push/preferences', headers, payload: { showContent: false } });
    assert.equal(patch.statusCode, 200);
    assert.deepEqual(patch.json(), { showContent: false });
    assert.equal(await getPushShowContent(user.id), false);
    assert.equal(await getPushShowContent(other.id), true);
  });

  it('refuses anything that is not a boolean', async () => {
    const user = await makeUser('pc');
    const headers = await asUser(user.id);
    for (const showContent of ['false', 0, null, undefined]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/notifications/push/preferences', headers, payload: { showContent } });
      assert.equal(res.statusCode, 400, String(showContent));
    }
    assert.equal(await getPushShowContent(user.id), true);
  });

  it('requires a session', async () => {
    assert.equal((await app.inject({ method: 'GET', url: '/api/notifications/push/preferences' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/notifications/push/preferences', payload: { showContent: false } })).statusCode, 401);
  });
});

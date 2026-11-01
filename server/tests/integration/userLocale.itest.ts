import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { db, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

async function asUser(userId: string) {
  const token = (await createSession(userId)).rawToken;
  return { cookie: `${config.SESSION_COOKIE}=${token}` };
}

describe('account language (real Postgres)', () => {
  it('starts as pt-BR for an existing-style account', async () => {
    const user = await makeUser('loc');
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: await asUser(user.id) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().user.locale, 'pt-BR');
  });

  it('PATCH stores the language and the very next /me already returns it', async () => {
    const user = await makeUser('loc');
    const headers = await asUser(user.id);
    // warm the 60s session cache first: the PATCH has to invalidate it
    await app.inject({ method: 'GET', url: '/api/auth/me', headers });

    const patch = await app.inject({ method: 'PATCH', url: '/api/me/locale', headers, payload: { locale: 'en-US' } });
    assert.equal(patch.statusCode, 200);
    assert.deepEqual(patch.json(), { locale: 'en-US' });

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers });
    assert.equal(me.json().user.locale, 'en-US');
    const [row] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, user.id));
    assert.equal(row!.locale, 'en-US');
  });

  it('refuses an unsupported language and keeps the stored one', async () => {
    const user = await makeUser('loc');
    const headers = await asUser(user.id);
    for (const locale of ['fr-FR', 'en', '', null, 42]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/me/locale', headers, payload: { locale } });
      assert.equal(res.statusCode, 400, String(locale));
    }
    const [row] = await db.select({ locale: users.locale }).from(users).where(eq(users.id, user.id));
    assert.equal(row!.locale, 'pt-BR');
  });

  it('requires a session', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/me/locale', payload: { locale: 'en-US' } });
    assert.equal(res.statusCode, 401);
  });
});

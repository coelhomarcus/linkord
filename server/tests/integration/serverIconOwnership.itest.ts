import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { servers } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { db, makeOwnedAvatarUpload, makeServerWithMembers, makeUser, pool } from './helpers.js';

// A server icon goes through the exact same ownership check
// (isOwnedProfileImage) an account's avatar does — see profileUpdate.itest.ts
// for the check's own coverage. This file only proves the WIRING: whoever
// manages the server really can set its icon to their own upload, and can't
// claim someone else's.

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

async function patchIcon(userId: string, serverId: string, icon: string): Promise<number> {
  const { rawToken } = await createSession(userId);
  const res = await app.inject({ method: 'PATCH', url: `/api/servers/${serverId}`, payload: { icon }, headers: { cookie: `${config.SESSION_COOKIE}=${rawToken}` } });
  return res.statusCode;
}

const iconOf = async (serverId: string) => (await db.select({ icon: servers.icon }).from(servers).where(eq(servers.id, serverId)))[0]!.icon;

describe('server icon goes through the ownership check (real Postgres)', () => {
  it('the owner uses their own upload as the icon: accepted', async () => {
    const owner = await makeUser('si');
    const { serverId } = await makeServerWithMembers(owner.id, []);
    const url = await makeOwnedAvatarUpload(owner.id);
    assert.equal(await patchIcon(owner.id, serverId, url), 200);
    assert.equal(await iconOf(serverId), url);
  });

  it('an external URL is not taken as an icon: the picture stays as it was', async () => {
    const owner = await makeUser('si');
    const { serverId } = await makeServerWithMembers(owner.id, []);
    const url = await makeOwnedAvatarUpload(owner.id);
    await patchIcon(owner.id, serverId, url);
    await patchIcon(owner.id, serverId, 'https://exemplo.com/servidor.png');
    assert.equal(await iconOf(serverId), url);
  });

  it('another account\'s upload is refused, and a plain member cannot change the icon at all', async () => {
    const owner = await makeUser('si');
    const member = await makeUser('si');
    const { serverId } = await makeServerWithMembers(owner.id, [member.id]);
    await patchIcon(owner.id, serverId, await makeOwnedAvatarUpload(member.id));
    assert.equal(await iconOf(serverId), '', 'a reference the owner did not upload is not accepted');
    assert.equal(await patchIcon(member.id, serverId, await makeOwnedAvatarUpload(member.id)), 403);
  });
});

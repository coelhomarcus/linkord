import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import crypto from 'node:crypto';
import { pool, makeUser } from './helpers.js';

after(() => pool.end());

const tableExists = async (name: string) => (await pool.query('select to_regclass($1) as r', [`public.${name}`])).rows[0].r != null;

describe('schema on real Postgres', () => {
  it('migrations brought the database up to date (social, admin, reports, repairs tables)', async () => {
    for (const t of ['users', 'conversations', 'conversation_members', 'friendships', 'user_blocks', 'servers', 'server_members', 'server_roles', 'server_invitations', 'server_invites', 'channel_permission_overwrites', 'notifications', 'outbox_events', 'admin_audit_logs', 'reports', 'data_repairs']) {
      assert.equal(await tableExists(t), true, t);
    }
  });

  it('a server has exactly one @everyone, and a channel always belongs to a server', async () => {
    const owner = await makeUser('own');
    const serverId = crypto.randomUUID();
    await pool.query("insert into servers (id, name, owner_id) values ($1, 's', $2)", [serverId, owner.id]);
    await pool.query("insert into server_roles (id, server_id, name, is_default) values ($1, $2, '@everyone', true)", [crypto.randomUUID(), serverId]);
    await assert.rejects(pool.query("insert into server_roles (id, server_id, name, is_default) values ($1, $2, '@everyone', true)", [crypto.randomUUID(), serverId]), (err: { code?: string }) => err.code === '23505');
    await assert.rejects(pool.query("insert into conversations (id, type, title, updated_at) values ($1, 'text', 'loose', now())", [crypto.randomUUID()]), (err: { code?: string }) => err.code === '23514');
    await assert.rejects(pool.query("insert into conversations (id, type, title, updated_at) values ($1, 'group', 'old', now())", [crypto.randomUUID()]), (err: { code?: string }) => err.code === '23514');
  });

  it('an overwrite names exactly one target and one subject', async () => {
    const owner = await makeUser('own');
    const serverId = crypto.randomUUID();
    const roleId = crypto.randomUUID();
    await pool.query("insert into servers (id, name, owner_id) values ($1, 's', $2)", [serverId, owner.id]);
    await pool.query("insert into server_roles (id, server_id, name) values ($1, $2, 'r')", [roleId, serverId]);
    await assert.rejects(pool.query('insert into channel_permission_overwrites (id, server_id, role_id) values ($1, $2, $3)', [crypto.randomUUID(), serverId, roleId]), (err: { code?: string }) => err.code === '23514');
  });

  it('dm_key is unique: there are no two DMs for the same pair', async () => {
    const key = `k:${crypto.randomUUID()}`;
    await pool.query("insert into conversations (id, type, dm_key, updated_at) values ($1,'direct',$2, now())", [crypto.randomUUID(), key]);
    await assert.rejects(pool.query("insert into conversations (id, type, dm_key, updated_at) values ($1,'direct',$2, now())", [crypto.randomUUID(), key]), (err: { code?: string }) => err.code === '23505');
  });

  it('friendship stores the ordered pair (low < high) and rejects the reverse', async () => {
    const a = await makeUser('fr'); const b = await makeUser('fr');
    const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await assert.rejects(pool.query("insert into friendships (id, user_low_id, user_high_id, requested_by) values ($1,$2,$3,$2)", [crypto.randomUUID(), high, low]), (err: { code?: string }) => err.code === '23514');
  });
});

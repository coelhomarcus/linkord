import assert from 'node:assert/strict';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { eq, inArray } from 'drizzle-orm';
import { config } from '../../src/config/env.js';
import { playgroundForgottenAccounts, playgroundSkins, users } from '../../src/db/schema.js';
import { sweepDueAccountDeletions } from '../../src/modules/auth/accountDeletion.js';
import { syncPlayground, type PlaygroundPost } from '../../src/modules/playground/playgroundSync.js';
import { db, makeUser, pool } from './helpers.js';

// What the app owes the playground service, against the real database: a deleted account is queued in
// the deletion's own transaction, old skins are handed over, and nothing is dropped until the service
// took it.

after(async () => { await pool.end(); });

const saved = { url: config.PLAYGROUND_INTERNAL_URL, secret: config.PLAYGROUND_SECRET };
beforeEach(async () => {
  config.PLAYGROUND_INTERNAL_URL = 'http://playground.test';
  config.PLAYGROUND_SECRET = 's'.repeat(32);
  await db.delete(playgroundForgottenAccounts);
  await db.delete(playgroundSkins);
});
afterEach(() => {
  config.PLAYGROUND_INTERNAL_URL = saved.url;
  config.PLAYGROUND_SECRET = saved.secret;
});

function recorder(fail = false) {
  const calls: { route: string; body: Record<string, unknown> }[] = [];
  const send: PlaygroundPost = async (route, body) => {
    calls.push({ route, body: body as Record<string, unknown> });
    if (fail) throw new Error('down');
  };
  return { calls, send };
}

describe('playground sync', () => {
  it('a deleted account is queued with its deletion and forgotten once the service took it', async () => {
    const user = await makeUser('pgforget');
    await db.update(users).set({ deletionDueAt: new Date(Date.now() - 60_000) }).where(eq(users.id, user.id));
    await sweepDueAccountDeletions();
    const queued = await db.select().from(playgroundForgottenAccounts).where(eq(playgroundForgottenAccounts.userId, user.id));
    assert.equal(queued.length, 1);

    const down = recorder(true);
    await assert.rejects(syncPlayground(down.send));
    assert.equal((await db.select().from(playgroundForgottenAccounts)).length, 1, 'kept while the service is down');

    const up = recorder();
    assert.equal(await syncPlayground(up.send), false);
    assert.deepEqual(up.calls, [{ route: 'forget', body: { userIds: [user.id] } }]);
    assert.equal((await db.select().from(playgroundForgottenAccounts)).length, 0);
  });

  it('nothing is queued while the service is off', async () => {
    config.PLAYGROUND_INTERNAL_URL = '';
    const user = await makeUser('pgoff');
    await db.update(users).set({ deletionDueAt: new Date(Date.now() - 60_000) }).where(eq(users.id, user.id));
    await sweepDueAccountDeletions();
    assert.equal((await db.select().from(playgroundForgottenAccounts)).length, 0);
  });

  it('old skins are handed over and then deleted here', async () => {
    const ana = await makeUser('pgskin');
    const bia = await makeUser('pgskin');
    const updatedAt = new Date('2026-01-02T03:04:05.000Z');
    await db.insert(playgroundSkins).values([{ userId: ana.id, png: 'AAAA', updatedAt }, { userId: bia.id, png: 'BBBB', updatedAt }]);
    const up = recorder();
    await syncPlayground(up.send);
    assert.equal(up.calls.length, 1);
    assert.equal(up.calls[0]!.route, 'import-skins');
    const sent = (up.calls[0]!.body.skins as { userId: string; png: string; updatedAt: string }[]).sort((a, b) => a.png.localeCompare(b.png));
    assert.deepEqual(sent.map(({ png, updatedAt: at }) => ({ png, at })), [{ png: 'AAAA', at: updatedAt.toISOString() }, { png: 'BBBB', at: updatedAt.toISOString() }]);
    assert.equal((await db.select().from(playgroundSkins).where(inArray(playgroundSkins.userId, [ana.id, bia.id]))).length, 0);
  });
});

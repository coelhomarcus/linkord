import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq } from 'drizzle-orm';
import { adminAuditLogs, userBadges } from '../../src/db/schema.js';
import { getAdminUser, setUserBadge } from '../../src/modules/admin/adminUsers.js';
import { grantBadge, listUserBadges, revokeBadge } from '../../src/modules/badges/badgesRepository.js';
import { db, makeUser, pool } from './helpers.js';

after(() => pool.end());

const ctx = (actor: { id: string; username: string }) => ({ actor, reason: 'contribuiu com o projeto', requestId: 'itest' });

describe('profile badges (real Postgres)', () => {
  it('an admin grants and removes a badge, each with its trail', async () => {
    const admin = await makeUser('badgeadm', 'admin');
    const target = await makeUser('badgeuser');

    assert.deepEqual(await setUserBadge(ctx(admin), target.id, 'supporter', 'grant'), { code: 'ok' });
    assert.deepEqual(await setUserBadge(ctx(admin), target.id, 'developer', 'grant'), { code: 'ok' });
    assert.deepEqual(await setUserBadge(ctx(admin), target.id, 'developer', 'grant'), { code: 'already_held' });

    const held = await listUserBadges(target.id);
    assert.deepEqual(held.map((badge) => [badge.id, badge.source]), [['developer', 'admin'], ['supporter', 'admin']]);
    const [row] = await db.select().from(userBadges).where(and(eq(userBadges.userId, target.id), eq(userBadges.badge, 'developer')));
    assert.equal(row?.grantedBy, admin.id);

    assert.deepEqual(await setUserBadge(ctx(admin), target.id, 'developer', 'revoke'), { code: 'ok' });
    assert.deepEqual(await setUserBadge(ctx(admin), target.id, 'developer', 'revoke'), { code: 'not_held' });
    assert.deepEqual((await getAdminUser(target.id))?.badges.map((badge) => badge.id), ['supporter']);

    const trail = await db.select({ action: adminAuditLogs.action, detail: adminAuditLogs.detail }).from(adminAuditLogs).where(eq(adminAuditLogs.targetId, target.id));
    assert.deepEqual(trail.map((entry) => entry.action).sort(), ['user.grant_badge', 'user.grant_badge', 'user.revoke_badge']);
    assert.ok(trail.every((entry) => entry.detail.badge === 'developer' || entry.detail.badge === 'supporter'));
  });

  it('refuses an actor who is no longer an admin and an account that does not exist', async () => {
    const former = await makeUser('badgeformer');
    const target = await makeUser('badgetarget');
    const admin = await makeUser('badgeadm2', 'admin');
    assert.deepEqual(await setUserBadge(ctx(former), target.id, 'supporter', 'grant'), { code: 'forbidden' });
    assert.deepEqual(await setUserBadge(ctx(admin), 'missing-account', 'supporter', 'grant'), { code: 'not_found' });
    assert.deepEqual(await listUserBadges(target.id), []);
  });

  it('an automatic rule never removes a badge an admin gave', async () => {
    const target = await makeUser('badgeauto');
    await grantBadge(db, { userId: target.id, badge: 'supporter', source: 'admin', grantedBy: null });
    assert.equal(await revokeBadge(db, { userId: target.id, badge: 'supporter', source: 'automatic' }), 'not_held');
    assert.equal(await grantBadge(db, { userId: target.id, badge: 'supporter', source: 'automatic', grantedBy: null }), 'already_held');
    assert.deepEqual((await listUserBadges(target.id)).map((badge) => badge.source), ['admin']);
  });
});

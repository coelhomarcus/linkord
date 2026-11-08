import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { eq, sql } from 'drizzle-orm';
import { config } from '../../src/config/env.js';
import { adminAuditLogs, dataRepairs, messages, notifications, outboxEvents } from '../../src/db/schema.js';
import { registerRetentionTarget, clearRegisteredRetentionTargets } from '../../src/modules/retention/retentionTargets.js';
import { getLastRetentionSweep, sweepRetention } from '../../src/modules/retention/retentionSweeper.js';
import { db, makeServerWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);
const fast = { pauseMs: 0 };

const saved = { ...config };
const resetConfig = () => {
  config.AUDIT_RETENTION_DAYS = 0;
  config.DATA_REPAIRS_RETENTION_DAYS = 0;
  config.NOTIFICATION_READ_RETENTION_DAYS = 30;
  config.NOTIFICATION_UNREAD_RETENTION_DAYS = 90;
  config.OUTBOX_RETENTION_DAYS = 7;
};
beforeEach(resetConfig);
afterEach(() => { Object.assign(config, saved); clearRegisteredRetentionTargets(); });

async function audit(action: string, createdAt: Date): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(adminAuditLogs).values({ id, action, targetType: 'system', createdAt });
  return id;
}
const auditIds = async (action: string) => (await db.select({ id: adminAuditLogs.id }).from(adminAuditLogs).where(eq(adminAuditLogs.action, action))).map((r) => r.id);

/** A mention needs the message it points at; one message can back any number of rows. */
async function notificationFixture() {
  const user = await makeUser('ret');
  const channelId = (await makeServerWithMembers(user.id, [])).textChannelId;
  const [message] = await db.insert(messages).values({ conversationId: channelId, authorId: user.id, text: '' }).returning();
  const row = (over: Partial<typeof notifications.$inferInsert>) => ({
    id: crypto.randomUUID(), recipientId: user.id, kind: 'mention', messageId: message!.id, dedupeKey: crypto.randomUUID(), ...over,
  });
  const remaining = async () => (await db.select({ id: notifications.id }).from(notifications).where(eq(notifications.recipientId, user.id))).map((r) => r.id).sort();
  return { row, remaining };
}

describe('retention sweep, end to end (real Postgres)', () => {
  it('audit: removes entries older than the limit and keeps the newer ones', async () => {
    const tag = `itest.${crypto.randomUUID().slice(0, 8)}`;
    await audit(tag, ago(400));
    const fresh = await audit(tag, ago(10));
    config.AUDIT_RETENTION_DAYS = 365;

    const result = await sweepRetention(fast);
    assert.deepEqual(await auditIds(tag), [fresh]);
    assert.equal(result.targets.find((t) => t.key === 'admin_audit_logs')!.deleted >= 1, true);
  });

  it('audit: 0 keeps everything, however old', async () => {
    const tag = `itest.${crypto.randomUUID().slice(0, 8)}`;
    await audit(tag, ago(5000));
    config.AUDIT_RETENTION_DAYS = 0;
    const result = await sweepRetention(fast);
    assert.equal((await auditIds(tag)).length, 1);
    assert.equal(result.targets.find((t) => t.key === 'admin_audit_logs')!.cutoff, null);
    // the sweep is instance-wide: leave no ancient row for the next test to collect
    await db.delete(adminAuditLogs).where(eq(adminAuditLogs.action, tag));
  });

  it('deletes across several batches and leaves the newer rows alone', async () => {
    const tag = `itest.${crypto.randomUUID().slice(0, 8)}`;
    const oldRows = Array.from({ length: 25 }, () => ({ id: crypto.randomUUID(), action: tag, targetType: 'system', createdAt: ago(50) }));
    const freshRows = Array.from({ length: 3 }, () => ({ id: crypto.randomUUID(), action: tag, targetType: 'system', createdAt: ago(1) }));
    await db.insert(adminAuditLogs).values([...oldRows, ...freshRows]);
    config.AUDIT_RETENTION_DAYS = 30;

    const result = await sweepRetention({ ...fast, batchSize: 10 });
    const audited = result.targets.find((t) => t.key === 'admin_audit_logs')!;
    assert.equal(audited.deleted, 25);
    assert.equal(audited.batches, 3);
    assert.deepEqual((await auditIds(tag)).sort(), freshRows.map((r) => r.id).sort());
  });

  it('data_repairs: kept by default, removed once a limit is set', async () => {
    const run = crypto.randomUUID();
    await db.insert(dataRepairs).values([
      { id: crypto.randomUUID(), runId: run, kind: 'itest', targetType: 'group_member', targetId: 'old', createdAt: ago(400) },
      { id: crypto.randomUUID(), runId: run, kind: 'itest', targetType: 'group_member', targetId: 'new', createdAt: ago(1) },
    ]);
    const remaining = async () => (await db.select({ id: dataRepairs.targetId }).from(dataRepairs).where(eq(dataRepairs.runId, run))).map((r) => r.id).sort();

    await sweepRetention(fast);
    assert.deepEqual(await remaining(), ['new', 'old']);
    config.DATA_REPAIRS_RETENTION_DAYS = 365;
    await sweepRetention(fast);
    assert.deepEqual(await remaining(), ['new']);
  });

  it('notifications: read ones go after the read limit, unread ones after the unread limit', async () => {
    const { row, remaining } = await notificationFixture();
    const readOld = row({ createdAt: ago(60), readAt: ago(40) });
    const readFresh = row({ createdAt: ago(60), readAt: ago(5) });
    const unreadOld = row({ createdAt: ago(120) });
    const unreadFresh = row({ createdAt: ago(60) });
    await db.insert(notifications).values([readOld, readFresh, unreadOld, unreadFresh]);

    await sweepRetention(fast);
    assert.deepEqual(await remaining(), [readFresh.id, unreadFresh.id].sort());
  });

  it('notifications: 0 on the unread limit keeps unread ones forever while read ones still expire', async () => {
    const { row, remaining } = await notificationFixture();
    const unread = row({ createdAt: ago(3000) });
    const read = row({ createdAt: ago(3000), readAt: ago(3000) });
    await db.insert(notifications).values([unread, read]);
    config.NOTIFICATION_UNREAD_RETENTION_DAYS = 0;

    await sweepRetention(fast);
    assert.deepEqual(await remaining(), [unread.id]);
    await db.delete(notifications).where(eq(notifications.id, unread.id));
  });

  it('outbox: removes only delivered events past the limit; pending and exhausted ones stay', async () => {
    const user = await makeUser('ret');
    const ev = (over: Partial<typeof outboxEvents.$inferInsert>) => ({ id: crypto.randomUUID(), type: 'friend_request_created', audienceUserId: user.id, payload: {}, ...over });
    const deliveredOld = ev({ createdAt: ago(20), processedAt: ago(10) });
    const deliveredFresh = ev({ createdAt: ago(20), processedAt: ago(1) });
    const pendingOld = ev({ createdAt: ago(20) });
    const exhaustedOld = ev({ createdAt: ago(20), attempts: 8 });
    await db.insert(outboxEvents).values([deliveredOld, deliveredFresh, pendingOld, exhaustedOld]);

    await sweepRetention(fast);
    const left = (await db.select({ id: outboxEvents.id }).from(outboxEvents).where(eq(outboxEvents.audienceUserId, user.id))).map((r) => r.id).sort();
    assert.deepEqual(left, [deliveredFresh.id, pendingOld.id, exhaustedOld.id].sort());
  });

  it('records one audit entry for the run, which the same run does not delete', async () => {
    const user = await makeUser('ret');
    await db.insert(outboxEvents).values({ id: crypto.randomUUID(), type: 'x', audienceUserId: user.id, payload: {}, createdAt: ago(20), processedAt: ago(10) });
    config.AUDIT_RETENTION_DAYS = 1;
    const before = (await auditIds('retention.sweep')).length;

    await sweepRetention(fast);
    const [entry] = await db.select().from(adminAuditLogs).where(sql`${adminAuditLogs.action} = 'retention.sweep'`).orderBy(sql`${adminAuditLogs.createdAt} desc`).limit(1);
    assert.equal((await auditIds('retention.sweep')).length, before + 1);
    assert.equal(entry!.result, 'ok');
    assert.ok((entry!.detail as { deleted: Record<string, number> }).deleted.outbox_events >= 1);
  });

  it('a table registered later is swept, reported, and does not stop the built-in ones', async () => {
    const calls: number[] = [];
    registerRetentionTarget({ key: 'later_table', days: () => 14, deleteBatch: async (_cutoff, limit) => { calls.push(limit); return 4; } });
    assert.throws(() => registerRetentionTarget({ key: 'later_table', days: () => 1, deleteBatch: async () => 0 }), /already registered/);

    const result = await sweepRetention({ ...fast, batchSize: 100 });
    assert.deepEqual(calls, [100]);
    assert.equal(result.targets.at(-1)!.key, 'later_table');
    assert.equal(result.targets.at(-1)!.deleted, 4);
    assert.ok(result.targets.some((t) => t.key === 'outbox_events'));
    assert.equal(getLastRetentionSweep(), result);
  });
});

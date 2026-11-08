import { and, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { adminAuditLogs, dataRepairs, notifications, outboxEvents, serverAuditLogs } from '../../db/schema.js';
import type { RetentionTarget } from './retentionPolicy.js';

// Every table that grows with use and has a retention setting. Each batch is its own short
// statement that picks a bounded set of ids first, so a delete never holds a long lock.
//
// Not here: login sessions (swept when they expire, modules/auth/session.ts) and chat send
// operations (modules/messages/sendOperations.ts), which have a fixed window of their own.

const builtIn: RetentionTarget[] = [
  {
    key: 'admin_audit_logs',
    days: () => config.AUDIT_RETENTION_DAYS,
    async deleteBatch(cutoff, limit) {
      const t = adminAuditLogs;
      const rows = await db.delete(t)
        .where(inArray(t.id, db.select({ id: t.id }).from(t).where(lt(t.createdAt, cutoff)).orderBy(t.createdAt).limit(limit)))
        .returning({ id: t.id });
      return rows.length;
    },
  },
  {
    key: 'server_audit_logs',
    days: () => config.SERVER_AUDIT_RETENTION_DAYS,
    async deleteBatch(cutoff, limit) {
      const t = serverAuditLogs;
      const rows = await db.delete(t)
        .where(inArray(t.id, db.select({ id: t.id }).from(t).where(lt(t.createdAt, cutoff)).orderBy(t.createdAt).limit(limit)))
        .returning({ id: t.id });
      return rows.length;
    },
  },
  {
    key: 'data_repairs',
    days: () => config.DATA_REPAIRS_RETENTION_DAYS,
    async deleteBatch(cutoff, limit) {
      const t = dataRepairs;
      const rows = await db.delete(t)
        .where(inArray(t.id, db.select({ id: t.id }).from(t).where(lt(t.createdAt, cutoff)).orderBy(t.createdAt).limit(limit)))
        .returning({ id: t.id });
      return rows.length;
    },
  },
  {
    key: 'notifications_read',
    days: () => config.NOTIFICATION_READ_RETENTION_DAYS,
    async deleteBatch(cutoff, limit) {
      const t = notifications;
      const rows = await db.delete(t)
        .where(inArray(t.id, db.select({ id: t.id }).from(t).where(and(isNotNull(t.readAt), lt(t.readAt, cutoff))).limit(limit)))
        .returning({ id: t.id });
      return rows.length;
    },
  },
  {
    key: 'notifications_unread',
    days: () => config.NOTIFICATION_UNREAD_RETENTION_DAYS,
    async deleteBatch(cutoff, limit) {
      const t = notifications;
      const rows = await db.delete(t)
        .where(inArray(t.id, db.select({ id: t.id }).from(t).where(and(isNull(t.readAt), lt(t.createdAt, cutoff))).limit(limit)))
        .returning({ id: t.id });
      return rows.length;
    },
  },
  {
    // only delivered events: one that ran out of attempts stays visible to an administrator
    key: 'outbox_events',
    days: () => config.OUTBOX_RETENTION_DAYS,
    async deleteBatch(cutoff, limit) {
      const t = outboxEvents;
      const rows = await db.delete(t)
        .where(inArray(t.id, db.select({ id: t.id }).from(t).where(and(isNotNull(t.processedAt), lt(t.processedAt, cutoff))).limit(limit)))
        .returning({ id: t.id });
      return rows.length;
    },
  },
];

const registered: RetentionTarget[] = [];

/** The hook for tables that appear later: register one target next to the
 * table's code and the daily sweep, the admin page and the audit entry all pick it up. */
export function registerRetentionTarget(target: RetentionTarget): void {
  if ([...builtIn, ...registered].some((t) => t.key === target.key)) throw new Error(`retention target "${target.key}" is already registered`);
  registered.push(target);
}

/** Test seam: forget what was registered. */
export function clearRegisteredRetentionTargets(): void {
  registered.length = 0;
}

export const retentionTargets = (): RetentionTarget[] => [...builtIn, ...registered];

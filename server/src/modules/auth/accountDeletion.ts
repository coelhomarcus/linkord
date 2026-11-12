import { and, asc, eq, gt, isNotNull, lte, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { users } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { recordAudit, type AuditActor } from '../admin/auditLog.js';
import { dropUserConnections } from '../admin/accountEnforcement.js';
import { purgeUserAccount } from '../admin/adminUsers.js';
import { resolveLocale } from '../users/locale.js';
import { isEmailDeliveryConfigured, sendAccountDeletedEmail, sendAccountDeletionScheduledEmail } from './email.js';
import { destroyAllSessionsForUser } from './session.js';

const log = logger.child({ component: 'account-deletion' });

// Deleting your own account (LGPD): asking for it (password, plus the emailed code with two-step login on)
// schedules the deletion ACCOUNT_DELETION_GRACE_DAYS ahead and signs the account out everywhere. Signing
// in again before then cancels it; after it, the sweep runs the admin deletion (admin/adminUsers.ts):
// server succession, sessions, live connections, files. The routes are in auth/routes.ts.

const DAY_MS = 24 * 60 * 60 * 1000;

export type ScheduleResult = { code: 'ok'; dueAt: Date } | { code: 'not_found' | 'last_admin' };

/** Schedules the deletion of `actor`'s own account. The last admin able to stay is refused, as the
 * admin area refuses deleting them: an admin due for deletion does not count, so two admins cannot each
 * leave on the other's account. */
export async function scheduleAccountDeletion(actor: AuditActor, requestId: string, now = new Date()): Promise<ScheduleResult> {
  const dueAt = new Date(now.getTime() + config.ACCOUNT_DELETION_GRACE_DAYS * DAY_MS);
  const outcome = await db.transaction(async (tx): Promise<ScheduleResult & { email?: string | null; locale?: string }> => {
    // the same lock order as the admin actions (every admin, then the target), so they serialize
    const admins = (await tx.execute(sql`select id, status, deletion_due_at from users where role = 'admin' order by id for update`)).rows as
      { id: string; status: string; deletion_due_at: Date | null }[];
    const [target] = (await tx.execute(sql`select id, role, status, email, locale from users where id = ${actor.id} for update`)).rows as
      { id: string; role: string; status: string; email: string | null; locale: string }[];
    if (!target) return { code: 'not_found' };
    const staying = admins.filter((a) => a.status === 'active' && !a.deletion_due_at && a.id !== actor.id);
    if (target.role === 'admin' && target.status === 'active' && staying.length === 0) return { code: 'last_admin' };
    await tx.update(users).set({ deletionRequestedAt: now, deletionDueAt: dueAt, updatedAt: now }).where(eq(users.id, actor.id));
    await recordAudit({
      actor, action: 'account.deletion_schedule', targetType: 'user', targetId: actor.id, targetLabel: actor.username,
      detail: { dueAt: dueAt.toISOString() }, requestId,
    }, tx);
    return { code: 'ok', dueAt, email: target.email, locale: target.locale };
  });
  if (outcome.code !== 'ok') return outcome;

  // signed out everywhere: the next sign-in is what cancels
  await destroyAllSessionsForUser(actor.id);
  dropUserConnections(actor.id);
  log.warn('account deletion scheduled', { userId: actor.id, dueAt: dueAt.toISOString() });
  if (outcome.email && isEmailDeliveryConfigured()) {
    await sendAccountDeletionScheduledEmail({ to: outcome.email, username: actor.username, locale: resolveLocale(outcome.locale), dueAt })
      .catch((err) => log.warn('could not email the scheduled deletion', { userId: actor.id, err }));
  }
  return { code: 'ok', dueAt };
}

/** Whether the account's grace period is over: it is about to be deleted, and can no longer sign in. */
export function isPastDeletion(user: { deletionDueAt: Date | null }, now = new Date()): boolean {
  return user.deletionDueAt !== null && user.deletionDueAt.getTime() <= now.getTime();
}

/** Called when a sign-in creates a session: a deletion still in its grace period is cancelled. Returns
 * whether there was one. The condition is in the UPDATE, so a sweep holding the row cannot lose to it. */
export async function cancelScheduledDeletion(actor: AuditActor, requestId: string, now = new Date()): Promise<boolean> {
  const [row] = await db.update(users).set({ deletionRequestedAt: null, deletionDueAt: null, updatedAt: now })
    .where(and(eq(users.id, actor.id), isNotNull(users.deletionDueAt), gt(users.deletionDueAt, now)))
    .returning({ id: users.id });
  if (!row) return false;
  await recordAudit({ actor, action: 'account.deletion_cancel', targetType: 'user', targetId: actor.id, targetLabel: actor.username, requestId });
  log.info('account deletion cancelled by signing in', { userId: actor.id });
  return true;
}

/** Thrown when a sweep starts while another one is still running. */
export class DeletionSweepInProgressError extends Error {
  constructor() { super('An account deletion sweep is already running.'); }
}

let sweeping = false;
const SWEEP_BATCH = 50;

/** Deletes the accounts whose grace period is over, oldest first. Each one is re-checked under its row
 * lock: a sign-in that cancelled in the meantime wins. */
export async function sweepDueAccountDeletions(now = new Date()): Promise<{ deleted: number; failed: number }> {
  if (sweeping) throw new DeletionSweepInProgressError();
  sweeping = true;
  let deleted = 0;
  let failed = 0;
  try {
    const due = await db.select({ id: users.id }).from(users)
      .where(and(isNotNull(users.deletionDueAt), lte(users.deletionDueAt, now)))
      .orderBy(asc(users.deletionDueAt)).limit(SWEEP_BATCH);
    for (const { id } of due) {
      try {
        const result = await purgeUserAccount(
          { actor: null, reason: 'exclusão pedida pelo titular', requestId: '' },
          id,
          ({ target }) => (target.deletion_due_at && new Date(target.deletion_due_at).getTime() <= now.getTime() ? 'ok' : 'not_found'),
        );
        if (result.code !== 'ok') continue;
        deleted++;
        const { account } = result;
        if (account.email && isEmailDeliveryConfigured()) {
          await sendAccountDeletedEmail({ to: account.email, username: account.username, locale: resolveLocale(account.locale) })
            .catch((err) => log.warn('could not email the finished deletion', { userId: id, err }));
        }
      } catch (err) {
        failed++;
        log.error('scheduled account deletion failed', err, { userId: id });
      }
    }
    return { deleted, failed };
  } finally {
    sweeping = false;
  }
}

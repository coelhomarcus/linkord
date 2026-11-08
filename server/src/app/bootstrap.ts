import { syncConnections } from '../modules/connections/syncWorker.js';
import { config } from '../config/env.js';
import { broadcast, restoreCallParticipants, setCallPresenceStore } from '../modules/presence/participants.js';
import { callPresenceStore, loadCallPresence } from '../modules/presence/callPresenceRepository.js';
import { restoreDmCalls, setDmCallStore } from '../modules/calls/dmCalls.js';
import { dmCallStore, loadActiveDmCalls } from '../modules/calls/dmCallRepository.js';
import { createApp } from '../http/app.js';
import { createWsServer } from '../realtime/socket.js';
import { describeBlockedMigration, runMigrations } from '../db/migrate.js';
import { sweepExpiredSessions } from '../modules/auth/session.js';
import { sweepExpiredRateLimits } from '../modules/auth/ratelimit.js';
import { sweepSendOperations } from '../modules/messages/sendOperations.js';
import { sweepExpiredStaged } from '../modules/attachments/stagedAttachments.js';
import { ensureUploadDir, sweepStaleUploads } from '../modules/attachments/uploadSession.js';
import { SweepInProgressError, sweepOrphans } from '../modules/attachments/orphanSweeper.js';
import { drainOutbox } from '../modules/notifications/outboxWorker.js';
import { OUTBOX_POLL_MS } from '../modules/notifications/notificationsPolicy.js';
import { RetentionSweepInProgressError, sweepRetention } from '../modules/retention/retentionSweeper.js';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'process' });

// backstop behind the try/catch in each handler in realtime/socket.ts —
// covers any async error escaping the normal message cycle (a timer, a
// stray promise) that would otherwise kill the process (Node exits on
// unhandledRejection/uncaughtException by default), disconnecting the room.
process.on('unhandledRejection', (err) => {
  log.error('unhandledRejection', err);
});
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err);
});

/** A restart must look like a short network drop to everyone in a call: the media
 * lives on LiveKit and keeps flowing, so what comes back here is who was in which
 * call (under the same ids, which are the LiveKit identities). Failing to restore
 * is not worth refusing to boot — clients fall back to rejoining. */
async function restoreCalls(): Promise<void> {
  try {
    const [presence, dmCalls] = await Promise.all([loadCallPresence(), loadActiveDmCalls()]);
    const restored = restoreCallParticipants(presence, config.CALL_RESTORE_GRACE_MS);
    restoreDmCalls(dmCalls);
    if (restored > 0 || dmCalls.length > 0) log.info('calls restored', { participants: restored, dmCalls: dmCalls.length });
  } catch (err) {
    log.error('failed to restore calls', err);
  }
  // only after the load: a write before it could delete a row that is about to be restored
  setCallPresenceStore(callPresenceStore);
  setDmCallStore(dmCallStore);
}

export async function bootstrap(): Promise<void> {
  // neither the Docker CMD nor systemd ExecStart go through an npm script —
  // without migrating here, nobody applies migrations in production. Fail
  // loud and exit: booting with a stale schema is worse than not booting
  // (systemd's Restart=always will keep retrying, visibly in the logs).
  if (config.MIGRATE_ON_BOOT) {
    try {
      await runMigrations();
      log.info('migrations up to date');
    } catch (err) {
      log.error(describeBlockedMigration(err) ?? 'failed to apply migrations', describeBlockedMigration(err) ? undefined : err);
      process.exit(1);
    }
  }

  // attachments folder (config.UPLOAD_DIR, usually a bind mount) — create
  // it if empty, otherwise the first upload would fail with ENOENT. Also
  // cleans up abandoned chunked-upload sessions (tab closed/browser crash
  // before the server's last shutdown).
  try {
    await ensureUploadDir();
    await sweepStaleUploads();
  } catch (err) {
    log.error('failed to prepare the uploads folder', err);
    process.exit(1);
  }

  await restoreCalls();

  const fastify = createApp();
  // fastify.server (the underlying http.Server) already exists once
  // Fastify() is called, before listen() — Socket.IO attaches to it the
  // same way it would to a plain http.Server, no change needed in
  // realtime/socket.ts.
  const io = createWsServer(fastify.server);

  await fastify.listen({ port: config.PORT, host: config.HOST_BIND });
  log.info('listening', { host: config.HOST_BIND, port: config.PORT });
  if (!config.LIVEKIT_URL || !config.LIVEKIT_API_KEY || !config.LIVEKIT_API_SECRET) {
    log.warn('LiveKit is not configured: calls, camera and screen sharing will fail');
  }

  const runConnectionSync = () => syncConnections().catch((err) => log.error('failed to sync profile connections', err));
  void runConnectionSync();
  const connectionSyncTimer = setInterval(runConnectionSync, 60_000);
  connectionSyncTimer.unref();

  // periodic cleanup of expired sessions — doesn't need to run per
  // request, just enough to keep the table from growing forever.
  const sessionSweepTimer = setInterval(() => {
    sweepExpiredSessions().catch((err) => log.error('failed to clean up expired sessions', err));
  }, 60 * 60 * 1000);
  sessionSweepTimer.unref();

  // brute-force counters (login, recovery, sign-up): a row whose window is over is dead weight
  const rateLimitSweepTimer = setInterval(() => {
    sweepExpiredRateLimits().catch((err) => log.error('failed to clean up expired rate limit windows', err));
  }, 15 * 60 * 1000);
  rateLimitSweepTimer.unref();

  // same cadence — upload session TTL is 24h (config.UPLOAD_SESSION_TTL_MS),
  // checking hourly is enough to avoid orphaned chunks piling up on disk.
  const uploadSweepTimer = setInterval(() => {
    sweepStaleUploads().catch((err) => log.error('failed to clean up abandoned uploads', err));
    sweepExpiredStaged().catch((err) => log.error('failed to clean up expired staged attachments', err));
  }, 60 * 60 * 1000);
  uploadSweepTimer.unref();

  // Transactional outbox: drain the events written with each social change
  // (safety net for a lost live emit).
  const pumpOutbox = () => drainOutbox()
    .then((r) => { if (r.failed > 0) log.warn('outbox events failed to deliver', r); else if (r.processed > 0) log.debug('outbox drained', r); })
    .catch((err) => log.error('failed to drain', err));
  const outboxTimer = setInterval(pumpOutbox, OUTBOX_POLL_MS);
  outboxTimer.unref();
  // Old audit entries, notifications and outbox rows, per the *_RETENTION_DAYS settings.
  // Also shortly after boot: a process that is redeployed more often than daily would
  // otherwise never get to run it.
  const sweepRetentionRows = () => sweepRetention()
    .catch((err) => { if (!(err instanceof RetentionSweepInProgressError)) log.error('retention sweep failed', err); });
  setTimeout(sweepRetentionRows, 120_000).unref();
  const retentionTimer = setInterval(sweepRetentionRows, 24 * 60 * 60 * 1000);
  retentionTimer.unref();
  const sendOpsTimer = setInterval(() => {
    sweepSendOperations().catch((err) => log.error('failed to prune chat send operations', err));
  }, 24 * 60 * 60 * 1000);
  sendOpsTimer.unref();

  // Files on disk with no row behind them (a failed unlink, a crash mid-commit).
  // The scheduled run only reports unless ORPHAN_SWEEP_DRY_RUN=0; an admin can
  // run a real one from /admin/system.
  const sweepOrphanFiles = () => sweepOrphans({ dryRun: config.ORPHAN_SWEEP_DRY_RUN, actor: null })
    .then((r) => { if (r.orphanCount > 0) log.info('orphan files found', { count: r.orphanCount, bytes: r.orphanBytes, dryRun: r.dryRun, deleted: r.deleted }); })
    // an admin's run is already doing this work: skip, the next tick will come
    .catch((err) => { if (!(err instanceof SweepInProgressError)) log.error('orphan sweep failed', err); });
  setTimeout(sweepOrphanFiles, 60_000).unref();
  const orphanTimer = setInterval(sweepOrphanFiles, 24 * 60 * 60 * 1000);
  orphanTimer.unref();

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      log.info('shutting down', { signal: sig });
      clearInterval(connectionSyncTimer);
      broadcast({ t: 'server-restart' });
      // Not removeParticipant: leaving the call for everyone is exactly what a
      // deploy must not do. The persisted rows are what the next process restores.
      // Not socket.disconnect() either: behind the proxy its disconnect packet
      // reaches the browser, and a Socket.IO client never reconnects on its own
      // after one ("io server disconnect"), so tabs sat offline until focused.
      // io.close() only drops the transports, which every client (old builds
      // included) treats as a network drop and reconnects from.
      io.close();
      fastify.close().then(() => process.exit(0)).catch(() => process.exit(1));
      setTimeout(() => process.exit(0), 3000).unref();
    });
  }
}

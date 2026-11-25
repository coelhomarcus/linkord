import { setTimeout as sleep } from 'node:timers/promises';
import { installProcessLifecycle } from './app/processLifecycle.js';
import { pool } from './db/client.js';
import { logger } from './lib/logger.js';
import { syncConnections } from './modules/connections/syncWorker.js';

const POLL_INTERVAL_MS = 5_000;
const SHUTDOWN_DEADLINE_MS = 8_000;
const log = logger.child({ component: 'connection-sync' });
const shutdown = new AbortController();
const lifecycle = installProcessLifecycle(process, log, SHUTDOWN_DEADLINE_MS);

async function poll(signal: AbortSignal): Promise<void> {
  while (!signal.aborted) {
    // Retry while PostgreSQL is unavailable or the backend is still applying migrations.
    await syncConnections({ signal }).catch((err) => log.error('failed to sync profile connections', err));
    await sleep(POLL_INTERVAL_MS, undefined, { signal }).catch((err: unknown) => {
      if (!signal.aborted) throw err;
    });
  }
}

log.info('profile connection sync worker started');
const running = poll(shutdown.signal);
lifecycle.ready({
  stop: () => shutdown.abort(),
  close: async () => {
    await running;
    await pool.end();
  },
});

import http from 'node:http';
import { missingConfig, readConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { databaseExperienceStore } from './experience.js';
import { setExperienceStore } from './combat.js';
import { createPlaygroundSocket } from './socket.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'process' });

// The playground service: the game state of playground calls (fighting and
// experience today), apart from the app so a restart of either leaves the other
// running. The app hands each player a short-lived pass (PLAYGROUND_SECRET), and
// the browser brings it here over Socket.IO. Deployed from the app's own image
// with `node playground/dist/index.js`.

const READY_CACHE_MS = 5000;

async function main(): Promise<void> {
  const missing = missingConfig(process.env);
  if (missing) {
    // a development run (`npm run dev`) without the playground configured: the app works without it
    log.warn(`not starting: ${missing} (see .env.example)`);
    process.exitCode = process.env.NODE_ENV === 'production' ? 1 : 0;
    return;
  }
  const config = readConfig(process.env);
  const { pool, db } = openDatabase(config);
  await runMigrations(db);
  setExperienceStore(databaseExperienceStore(db));

  let readyAt = 0;
  let ready = false;
  async function isReady(): Promise<boolean> {
    if (Date.now() - readyAt < READY_CACHE_MS) return ready;
    try {
      await Promise.race([pool.query('SELECT 1'), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000).unref())]);
      ready = true;
    } catch (err) {
      if (ready || readyAt === 0) log.warn('not ready', { reason: err instanceof Error ? err.message : String(err) });
      ready = false;
    }
    readyAt = Date.now();
    return ready;
  }

  const server = http.createServer((req, res) => {
    const route = (req.url ?? '').split('?')[0];
    const answer = (status: number, body: object) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (route === '/healthz' || route === '/playground/healthz') return answer(200, { ok: true });
    if (route === '/readyz' || route === '/playground/readyz') {
      void isReady().then((ok) => answer(ok ? 200 : 503, { ok }));
      return;
    }
    answer(404, { ok: false });
  });
  const socket = createPlaygroundSocket(server, config.secret);
  server.listen(config.port, config.hostBind, () => log.info('listening', { port: config.port }));

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    socket.stop();
    // clients reconnect on their own with a fresh pass (useful for a deploy); health is kept in
    // memory, so it starts over, while experience is in the database
    socket.io.close(() => { void pool.end().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  log.error('failed to start', err);
  process.exit(1);
});

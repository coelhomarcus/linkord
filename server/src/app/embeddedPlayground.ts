import { spawn as spawnProcess, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { Logger } from '../lib/logger.js';

// The playground service (playground/ at the repo root) run by this process, in
// the same container, for a deploy that wants one service rather than two
// (PLAYGROUND_EMBEDDED=1; docs/DEPLOY.md#playground-service). It stays its own
// process: a crash there is logged and the service started again, and never
// takes the app down; a restart of the app (a deploy) restarts it too. It shares
// this process's environment, so the same PLAYGROUND_* variables configure
// both, and listens on its own port; the app passes the game's websocket on
// /playground/ on to it (playgroundProxy.ts), so the proxy in front may route
// everything to the app.

/** compiled, this is server/dist/app/; the image keeps playground/dist next to server/ */
const PLAYGROUND_ENTRY = path.join(import.meta.dirname, '..', '..', '..', 'playground', 'dist', 'index.js');
const RESTART_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];
/** a run this long counts as healthy: the next crash starts the delays over */
const STABLE_RUN_MS = 60_000;
/** what a shutdown waits for it, inside the process's own deadline (processLifecycle.ts) */
const STOP_WAIT_MS = 2000;

/** How long to wait before starting it again, after `crashes` crashes in a row. */
export function restartDelay(crashes: number): number {
  return RESTART_DELAYS_MS[Math.min(Math.max(crashes, 1), RESTART_DELAYS_MS.length) - 1]!;
}

export interface EmbeddedPlaygroundOptions {
  port: number;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
  entry?: string;
  spawn?: (entry: string, env: NodeJS.ProcessEnv) => ChildProcess;
  now?: () => number;
}

export interface EmbeddedPlayground {
  /** Asks it to stop (SIGTERM) and waits for it, a little. */
  stop(): Promise<void>;
}

// An IPC channel, so the child notices this process is gone (playground/src/index.ts) and never
// outlives it outside a container
const defaultSpawn = (entry: string, env: NodeJS.ProcessEnv) =>
  spawnProcess(process.execPath, [entry], { env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });

export function startEmbeddedPlayground(options: EmbeddedPlaygroundOptions): EmbeddedPlayground {
  const { port, log } = options;
  const entry = options.entry ?? PLAYGROUND_ENTRY;
  const spawn = options.spawn ?? defaultSpawn;
  const now = options.now ?? Date.now;
  let child: ChildProcess | null = null;
  let stopping = false;
  let crashes = 0;
  let restartTimer: NodeJS.Timeout | null = null;

  function start(): void {
    restartTimer = null;
    const startedAt = now();
    const started = spawn(entry, { ...process.env, PLAYGROUND_PORT: String(port) });
    child = started;
    log.info('playground service started in this container', { port, pid: started.pid ?? null });
    started.on('error', (err) => log.error('could not run the playground service', err));
    started.on('exit', (code, signal) => {
      if (child === started) child = null;
      if (stopping) return;
      crashes = now() - startedAt >= STABLE_RUN_MS ? 1 : crashes + 1;
      const delay = restartDelay(crashes);
      log.warn('playground service exited, starting it again', { exitCode: code, signal, inMs: delay });
      restartTimer = setTimeout(start, delay);
      restartTimer.unref();
    });
  }

  start();

  return {
    async stop() {
      stopping = true;
      if (restartTimer) clearTimeout(restartTimer);
      const running = child;
      if (!running || running.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STOP_WAIT_MS);
        timer.unref();
        running.once('exit', () => { clearTimeout(timer); resolve(); });
        running.kill('SIGTERM');
      });
    },
  };
}

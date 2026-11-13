import type { Logger } from '../lib/logger.js';

/** How long a shutdown may take before the process leaves anyway (a hung close, a socket that never drains). */
export const SHUTDOWN_DEADLINE_MS = 3000;

export interface ShutdownSteps {
  /** Synchronous part: stop timers, tell clients a restart is coming, drop the socket transports. */
  stop(): void;
  /** Stop accepting HTTP and wait for in-flight requests. */
  closeHttp(): Promise<void>;
}

/** The slice of `process` this module touches, so tests can drive it with an EventEmitter. */
export interface ProcessLike {
  on(event: 'uncaughtException' | 'unhandledRejection', listener: (err: unknown) => void): unknown;
  on(event: 'SIGINT' | 'SIGTERM', listener: () => void): unknown;
  exit(code: number): void;
}

export interface ProcessLifecycle {
  /** Called once the server is listening; before that a fatal error or a signal just exits. */
  ready(steps: ShutdownSteps): void;
}

/**
 * One way out of the process, shared by deploys (SIGTERM) and crashes.
 *
 * Resuming after an uncaught exception or an unhandled rejection is unsafe: the in-memory
 * call participants, DM call states and upload reservations may be half-updated, and the
 * process would keep serving wrong answers while /healthz stays green. Leaving through the
 * deploy path is cheap instead, because calls survive a restart: no removeParticipant, no
 * socket.disconnect(), so the persisted membership is restored by the next process, and the
 * supervisor (compose `restart: unless-stopped`, the Swarm restart policy) brings it back.
 */
export function installProcessLifecycle(proc: ProcessLike, log: Pick<Logger, 'info' | 'error'>, deadlineMs = SHUTDOWN_DEADLINE_MS): ProcessLifecycle {
  let steps: ShutdownSteps | null = null;
  let shuttingDown = false;
  let exitCode = 0;

  const exit = () => proc.exit(exitCode);

  function shutdown(code: number): void {
    // a crash during a deploy's shutdown still has to reach the supervisor as a failure
    exitCode = Math.max(exitCode, code);
    if (shuttingDown) return;
    shuttingDown = true;
    if (!steps) return exit();
    setTimeout(exit, deadlineMs).unref();
    try {
      steps.stop();
    } catch (err) {
      // state may be what is broken; closing HTTP and exiting still have to happen
      log.error('shutdown step failed', err);
    }
    steps.closeHttp().then(exit, (err: unknown) => {
      log.error('failed to close the HTTP server', err);
      exitCode = Math.max(exitCode, 1);
      exit();
    });
  }

  for (const kind of ['uncaughtException', 'unhandledRejection'] as const) {
    proc.on(kind, (err: unknown) => {
      log.error(`fatal ${kind}, shutting down`, err);
      shutdown(1);
    });
  }
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    proc.on(signal, () => {
      log.info('shutting down', { signal });
      shutdown(0);
    });
  }

  return { ready: (s) => { steps = s; } };
}

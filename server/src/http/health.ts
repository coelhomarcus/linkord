import type { FastifyInstance } from 'fastify';
import { logger } from '../lib/logger.js';

const log = logger.child({ component: 'health' });

export const READINESS_TIMEOUT_MS = 1000;
/** A probe every second from monitoring must not become a query every second on a
 * pool of a handful of connections. */
export const READINESS_CACHE_MS = 5000;

export interface ReadinessDeps {
  pingDb: () => Promise<unknown>;
  unwritableUploadDirs: () => Promise<string[]>;
  timeoutMs?: number;
  cacheMs?: number;
  now?: () => number;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** A refused connection reaches pg as an AggregateError with an empty message; its code
 * is what tells "down" from "slow". */
function describe(err: unknown): string {
  const e = err as (Error & { code?: string }) | undefined;
  return e?.message || e?.code || e?.name || String(err);
}

/** Returns a check that tells whether the app can serve requests. Concurrent callers
 * share one run, and its result is reused for `cacheMs`. */
export function createReadinessCheck(deps: ReadinessDeps): () => Promise<boolean> {
  const timeoutMs = deps.timeoutMs ?? READINESS_TIMEOUT_MS;
  const cacheMs = deps.cacheMs ?? READINESS_CACHE_MS;
  const now = deps.now ?? Date.now;
  let cached: { ready: boolean; at: number } | null = null;
  let inFlight: Promise<boolean> | null = null;
  let lastReady = true;

  async function run(): Promise<boolean> {
    const failures: Record<string, string> = {};
    const [dbResult, dirsResult] = await Promise.allSettled([
      withTimeout(deps.pingDb(), timeoutMs),
      withTimeout(deps.unwritableUploadDirs(), timeoutMs),
    ]);
    if (dbResult.status === 'rejected') failures.database = describe(dbResult.reason);
    if (dirsResult.status === 'rejected') failures.uploads = describe(dirsResult.reason);
    else if (dirsResult.value.length > 0) failures.uploads = `not writable: ${dirsResult.value.join(', ')}`;

    const ready = Object.keys(failures).length === 0;
    if (!ready) log.warn('not ready', failures);
    else if (!lastReady) log.info('ready again');
    lastReady = ready;
    return ready;
  }

  return async () => {
    if (cached && now() - cached.at < cacheMs) return cached.ready;
    inFlight ??= run()
      .then((ready) => {
        cached = { ready, at: now() };
        return ready;
      })
      .finally(() => { inFlight = null; });
    return inFlight;
  };
}

/** `/healthz` is the public liveness probe (Docker, Dokploy, the e2e stack). It answers
 * nothing but `ok`: connection counts and uptime would tell anyone when the server was
 * last deployed and how busy it is; administrators get those from `/api/admin/system`.
 *
 * `/readyz` says whether the app can actually serve: Postgres answers and the upload
 * folders are writable. It is just as terse, the reason goes to the log only. */
export function registerHealthRoute(fastify: FastifyInstance, isReady?: () => Promise<boolean>): void {
  fastify.get('/healthz', async () => ({ ok: true }));
  if (isReady) {
    fastify.get('/readyz', async (_request, reply) => {
      const ok = await isReady();
      reply.header('cache-control', 'no-store');
      return reply.code(ok ? 200 : 503).send({ ok });
    });
  }
}

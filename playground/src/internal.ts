import type { IncomingMessage, ServerResponse } from 'node:http';
import { verifyInternalRequest } from './access.js';
import { forgetExperience } from './combat.js';
import { parseSkinPng } from './skinPng.js';
import { skinStore, type SkinRow } from './skins.js';
import { allPlayers } from './roster.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'internal' });

// What the app tells this service, over HTTP under /playground/internal/, each
// request signed with PLAYGROUND_SECRET (access.ts). The app keeps what it has
// to send in its own database until this answers 200, so a request that fails
// is simply sent again later (server/src/modules/playground/playgroundSync.ts).
//
// - `forget`: accounts deleted in the app; their skins, experience and any
//   connection still open here go.
// - `import-skins`: skins saved in the app before this service kept them.

export const INTERNAL_PREFIX = '/playground/internal/';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_IDS = 500;
const MAX_SKINS = 50;

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;

class BadRequest extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        reject(new BadRequest('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function forget(body: Record<string, unknown>): Promise<void> {
  const { userIds } = body;
  if (!Array.isArray(userIds) || userIds.length > MAX_IDS || !userIds.every(isId)) throw new BadRequest('userIds');
  await skinStore().forget(userIds);
  await forgetExperience(userIds);
  const gone = new Set(userIds);
  for (const player of allPlayers()) {
    if (gone.has(player.userId)) {
      try { player.socket.disconnect(true); } catch { /* already gone */ }
    }
  }
  log.info('accounts forgotten', { count: userIds.length });
}

async function importSkins(body: Record<string, unknown>): Promise<void> {
  const { skins } = body;
  if (!Array.isArray(skins) || skins.length > MAX_SKINS) throw new BadRequest('skins');
  const rows: SkinRow[] = [];
  for (const entry of skins as Record<string, unknown>[]) {
    const png = parseSkinPng(entry?.png);
    const updatedAt = new Date(typeof entry?.updatedAt === 'string' ? entry.updatedAt : Number.NaN);
    // one the app should not have kept is dropped rather than refusing the whole batch
    if (isId(entry?.userId) && png && !Number.isNaN(updatedAt.getTime())) rows.push({ userId: entry.userId, png, updatedAt });
  }
  await skinStore().importNewer(rows);
  log.info('skins imported', { count: rows.length });
}

const ROUTES: Record<string, (body: Record<string, unknown>) => Promise<void>> = {
  forget,
  'import-skins': importSkins,
};

/** Answers a request under INTERNAL_PREFIX. */
export async function handleInternal(req: IncomingMessage, res: ServerResponse, route: string, secret: string): Promise<void> {
  const answer = (status: number, body: object) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const action = ROUTES[route.slice(INTERNAL_PREFIX.length)];
  if (!action || req.method !== 'POST') return answer(404, { ok: false });
  try {
    const raw = await readBody(req);
    if (!verifyInternalRequest(req.headers['x-playground-signature'], raw, secret, Date.now())) {
      log.warn('refused an unsigned internal request', { route });
      return answer(401, { ok: false });
    }
    let body: unknown;
    try { body = JSON.parse(raw); } catch { throw new BadRequest('json'); }
    if (!body || typeof body !== 'object') throw new BadRequest('json');
    await action(body as Record<string, unknown>);
    answer(200, { ok: true });
  } catch (err) {
    if (err instanceof BadRequest) return answer(400, { ok: false, error: err.message });
    log.error('internal request failed', err, { route });
    answer(500, { ok: false });
  }
}

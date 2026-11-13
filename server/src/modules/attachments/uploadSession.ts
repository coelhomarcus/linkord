import fs from 'node:fs/promises';
import fsStreams from 'node:fs'; // only for createReadStream/createWriteStream (chunk assembly), see assembleChunks
import path from 'node:path';
import { config } from '../../config/env.js';
import type { VoiceMeta } from './voiceMessages.js';

// Chunked upload for files up to MAX_ATTACHMENT_BYTES (512MB by default): a single POST that size
// wouldn't survive most proxies or be safe to buffer in memory. Upload
// session state lives on disk only (no DB table) — deployment is single-
// instance, so there's no need to share it across processes. `uploadId`
// becomes the final attachment id directly, no rename step. This is the
// disk/session mechanics only — the Fastify HTTP handlers that drive it
// live in attachmentUploads.ts, the only consumer that needs both halves;
// app/bootstrap.ts (boot-time dir prep + hourly sweep) and the test suite
// only ever need this half.

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
}

/** The upload folders this process cannot create files in. mkdir succeeds on
 * a folder that already exists, so a bind mount still owned by root (from
 * before the image ran as `node`) passes the boot and only fails at the first
 * upload; tmp/ is checked too because it may be the only part left behind. */
export async function unwritableUploadDirs(uploadDir = config.UPLOAD_DIR): Promise<string[]> {
  const unwritable: string[] = [];
  for (const dir of [uploadDir, path.join(uploadDir, 'tmp')]) {
    try {
      await fs.access(dir, fs.constants.W_OK | fs.constants.X_OK);
    } catch (err) {
      // a missing tmp/ is created by the first upload, as long as its parent is writable
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') unwritable.push(dir);
    }
  }
  return unwritable;
}

export function sanitizeFileName(raw: unknown): string {
  const s = String(raw == null ? '' : raw).trim().replace(/[\r\n/\\]/g, '_').slice(0, 200);
  return s || 'arquivo';
}

export interface UploadManifest {
  uploadId: string;
  userId: string;
  conversationId: string;
  fileName: string;
  mimeType: string;
  totalSize: number;
  chunkSize: number;
  totalChunks: number;
  createdAt: string;
  voice?: VoiceMeta;
}

export function tmpDirFor(uploadId: string): string {
  return path.join(config.UPLOAD_DIR, 'tmp', uploadId);
}

export function manifestPathFor(uploadId: string): string {
  return path.join(tmpDirFor(uploadId), 'manifest.json');
}

export function chunkPathFor(uploadId: string, index: number): string {
  // zero-padded so alphabetical sort matches numeric sort
  return path.join(tmpDirFor(uploadId), String(index).padStart(6, '0'));
}

/** null if missing or corrupt — caller treats that as 404. */
export async function readManifest(uploadId: string): Promise<UploadManifest | null> {
  try {
    return JSON.parse(await fs.readFile(manifestPathFor(uploadId), 'utf8'));
  } catch {
    return null;
  }
}

/** All chunks are chunkSize except the last, which is the remainder. */
export function expectedChunkLength(manifest: UploadManifest, index: number): number {
  return index === manifest.totalChunks - 1
    ? manifest.totalSize - manifest.chunkSize * (manifest.totalChunks - 1)
    : manifest.chunkSize;
}

/** Streams chunks in order into the final file — never Buffer.concat, which
 * is exactly what an upload of hundreds of MB needs to avoid. */
export async function assembleChunks(uploadId: string, manifest: UploadManifest, destPath: string): Promise<void> {
  const writeStream = fsStreams.createWriteStream(destPath);
  try {
    for (let i = 0; i < manifest.totalChunks; i++) {
      await new Promise<void>((resolve, reject) => {
        const readStream = fsStreams.createReadStream(chunkPathFor(uploadId, i));
        readStream.on('error', reject);
        writeStream.on('error', reject);
        readStream.pipe(writeStream, { end: false });
        readStream.on('end', resolve);
      });
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err: NodeJS.ErrnoException | null | undefined) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    writeStream.destroy();
    throw err;
  }
}

// Reserve declared sizes before chunks reach the database so concurrent uploads cannot bypass
// the instance-wide storage ceiling. Release a reservation only after its files are deleted; failed completes keep their
// chunks retryable. The stale-upload sweep rebuilds these in-memory totals after restart.
// Each one remembers its account (the per-account caps at init) and when it
// last saw a chunk: a reservation that stops receiving any is given back
// after UPLOAD_IDLE_TTL_MS, so declaring sizes without sending bytes cannot
// hold the instance's free space for long.
interface Reservation { userId: string; bytes: number; lastActivityMs: number }
const pendingUploads = new Map<string, Reservation>();

export function reserveUpload(uploadId: string, userId: string, bytes: number, lastActivityMs = Date.now()): void {
  pendingUploads.set(uploadId, { userId, bytes, lastActivityMs });
}

export function releaseUpload(uploadId: string): void {
  pendingUploads.delete(uploadId);
}

/** A chunk started arriving or was written: the session is alive. */
export function touchUpload(uploadId: string, now = Date.now()): void {
  const reservation = pendingUploads.get(uploadId);
  if (reservation && reservation.lastActivityMs < now) reservation.lastActivityMs = now;
}

/** Everything reserved, minus `exceptUploadId` (an upload checking the room
 * for itself, whose own reservation is already in the sum). */
export function getReservedBytes(exceptUploadId?: string): number {
  let sum = 0;
  for (const [id, { bytes }] of pendingUploads) if (id !== exceptUploadId) sum += bytes;
  return sum;
}

export function openUploadsOf(userId: string): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const reservation of pendingUploads.values()) {
    if (reservation.userId !== userId) continue;
    count += 1;
    bytes += reservation.bytes;
  }
  return { count, bytes };
}

function isIdle(lastActivityMs: number, now: number): boolean {
  return now - lastActivityMs > config.UPLOAD_IDLE_TTL_MS;
}

/** Drops the sessions that have had no chunk for UPLOAD_IDLE_TTL_MS, files
 * and reservation. Called by init before it counts reservations, so an idle
 * one never refuses anybody, whatever the sweep's cadence. */
export async function expireIdleUploads(now = Date.now()): Promise<number> {
  const idle = [...pendingUploads].filter(([id, r]) => isIdle(r.lastActivityMs, now) && !completingUploads.has(id)).map(([id]) => id);
  for (const id of idle) {
    releaseUpload(id);
    await fs.rm(tmpDirFor(id), { recursive: true, force: true }).catch(() => {});
  }
  return idle.length;
}

// Serializes the check-then-reserve section of init() across concurrent
// requests (single-instance deployment, same assumption as completingUploads
// below) — without this, two init()s could both read the same
// committed+reserved total before either adds its own reservation, letting
// both through even though their combined size exceeds the quota.
let initLock: Promise<unknown> = Promise.resolve();
export function withInitLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = initLock.then(fn, fn);
  initLock = result.then(() => undefined, () => undefined);
  return result;
}

// serializes concurrent complete() calls for the SAME uploadId — without
// this, a duplicate client retry could try to assemble/write the same final
// file twice. Process-lifetime only (correctly resets on restart).
export const completingUploads = new Set<string>();

/** Cleans up abandoned upload sessions (tab closed / browser crash before
 * complete or cancel, or a client that declared a size and never sent it) —
 * called at boot and hourly. A session goes once it is older than
 * UPLOAD_SESSION_TTL_MS or idle past UPLOAD_IDLE_TTL_MS. Also re-declares
 * the reservation (see pendingUploads) for every session still on disk: at
 * boot this REBUILDS the in-memory map from scratch (a restart wipes it, but
 * chunks already on disk don't disappear), its last activity being the
 * newest file in the session's folder; on the hourly runs it keeps the newer
 * of that and what memory saw. */
export async function sweepStaleUploads(now = Date.now()): Promise<void> {
  const tmpRoot = path.join(config.UPLOAD_DIR, 'tmp');
  let ids: string[];
  try {
    ids = await fs.readdir(tmpRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const id of ids) {
    if (completingUploads.has(id)) continue;
    const dir = path.join(tmpRoot, id);
    let createdAtMs: number;
    let manifest: UploadManifest | null = null;
    try {
      manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')) as UploadManifest;
      createdAtMs = new Date(manifest.createdAt).getTime();
    } catch {
      // manifest missing/corrupt — fall back to the folder's creation time
      // so it can still be swept.
      try {
        createdAtMs = (await fs.stat(dir)).birthtimeMs;
      } catch {
        continue;
      }
    }
    // no manifest, no reservation: such a folder only waits out the full TTL
    const lastActivityMs = manifest
      ? Math.max(createdAtMs, await newestFileMs(dir), pendingUploads.get(id)?.lastActivityMs ?? 0)
      : null;
    if (now - createdAtMs > config.UPLOAD_SESSION_TTL_MS || (lastActivityMs !== null && isIdle(lastActivityMs, now))) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      releaseUpload(id);
    } else if (manifest && lastActivityMs !== null) {
      reserveUpload(id, manifest.userId, manifest.totalSize, lastActivityMs);
    }
  }
}

async function newestFileMs(dir: string): Promise<number> {
  let newest = 0;
  try {
    for (const name of await fs.readdir(dir)) {
      const { mtimeMs } = await fs.stat(path.join(dir, name)).catch(() => ({ mtimeMs: 0 }));
      if (mtimeMs > newest) newest = mtimeMs;
    }
  } catch {
    // vanished while sweeping (cancelled or completed): nothing to keep alive
  }
  return newest;
}

import { ApiError } from '@/shared/api/api';
import { i18n } from '@/shared/i18n/init';
import { logger } from '@/shared/lib/logger';
import type { VoiceMeta } from '@/shared/types/protocol';

const log = logger.child({ component: 'upload' });


interface InitResponse {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
}

// Every error the app itself sends carries a code. A response without one came
// from the proxy in front of it, which answers 404 or 502 while a deploy swaps
// the container: the request was never seen, so it is worth sending again.
const PROXY_ERROR = 'proxy_error';

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try { body = await res.json(); } catch {  }
  const err = (body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string } }).error : null) || {};
  return new ApiError(res.status, err.code || PROXY_ERROR, err.message || i18n.t('errors.unexpected'), res.headers.get('Retry-After') ?? undefined);
}

async function runWithConcurrency(count: number, limit: number, task: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let firstError: unknown;
  async function worker() {
    while (next < count) {
      const i = next++;
      try {
        await task(i);
      } catch (err) {
        if (firstError === undefined) firstError = err;
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  if (firstError !== undefined) throw firstError;
}

const MAX_CONCURRENT_CHUNKS = 3;
const RETRY_BASE_MS = 500;
const RETRY_MAX_DELAY_MS = 5_000;
// How long a request keeps being retried while the server is unreachable. A
// deploy takes the app away for a few seconds to tens of seconds, and the
// upload is kept on the server's disk, so it resumes where it stopped.
const OUTAGE_WINDOW_MS = 60_000;
const MAX_RATE_LIMIT_WAITS = 3;
const MAX_RETRY_AFTER_MS = 60_000;

export interface StagedFile { id: string; name: string; mime: string; size: number; thumbId?: string; voice?: VoiceMeta }

// A 4xx from the app says the request itself is wrong (no access, too big,
// gone) — sending it again can't help. Timeouts, rate limits, 5xx and the
// proxy answering for an app that is restarting can.
function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true; // network failure
  return err.status >= 500 || err.status === 408 || err.status === 429 || err.code === PROXY_ERROR;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

/** Runs one request until it succeeds, it fails for good, or the server has
 * been away longer than OUTAGE_WINDOW_MS. A rate limit is waited out (its
 * Retry-After) a few times instead, since the server is up and answering. */
async function retrying<T>(attempt: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const started = Date.now();
  let rateLimitWaits = 0;
  for (let tries = 0; ; tries++) {
    try {
      return await attempt();
    } catch (err) {
      if (signal?.aborted || !isRetryable(err)) throw err;
      let delay = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_MS * 2 ** tries);
      if (err instanceof ApiError && err.status === 429) {
        if (rateLimitWaits++ >= MAX_RATE_LIMIT_WAITS) throw err;
        const seconds = Number(err.retryAfter);
        if (Number.isFinite(seconds) && seconds > 0) delay = Math.min(MAX_RETRY_AFTER_MS, seconds * 1000);
      } else if (Date.now() - started + delay > OUTAGE_WINDOW_MS) {
        throw err;
      }
      await wait(delay, signal);
    }
  }
}

async function post(url: string, body: BodyInit, contentType: string, signal?: AbortSignal): Promise<Response> {
  const res = await fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': contentType }, body, signal });
  if (!res.ok) throw await toApiError(res);
  return res;
}

interface UploadRun {
  conversationId: string;
  file: File;
  voice?: VoiceMeta;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Stages the file: uploaded in chunks, but not published to anyone. The
 * message that carries it (with the whole batch) is created later by one
 * correlated `chat` send — see stageFileInChunks below, its only caller. */
async function runUpload({ conversationId, file, voice, onProgress, signal }: UploadRun): Promise<unknown> {
  if (!conversationId) throw new ApiError(400, 'missing_conversation', i18n.t('upload.missingConversation'));
  const initBody = JSON.stringify({ conversationId, fileName: file.name, mimeType: file.type || 'application/octet-stream', totalSize: file.size, ...(voice ? { voice } : {}) });
  const initRes = await retrying(() => post('/api/attachments/init', initBody, 'application/json', signal), signal);
  const { uploadId, chunkSize, totalChunks } = await initRes.json() as InitResponse;

  const sentPerChunk = new Array(totalChunks).fill(0);
  function reportProgress() {
    if (file.size <= 0) return;
    const sent = sentPerChunk.reduce((a, b) => a + b, 0);
    onProgress?.(sent / file.size);
  }

  // a chunk sent again overwrites the same piece on the server, so a retry after
  // a restart picks the upload up where it stopped
  async function uploadChunk(index: number): Promise<void> {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);
    await retrying(() => post(`/api/attachments/${uploadId}/chunk/${index}`, blob, 'application/octet-stream', signal), signal);
    sentPerChunk[index] = blob.size;
    reportProgress();
  }

  try {
    await runWithConcurrency(totalChunks, MAX_CONCURRENT_CHUNKS, uploadChunk);
    // complete is safe to repeat (the server answers a repeat with the same
    // staged file), so a lost reply is retried instead of failing the file
    const completeRes = await retrying(() => post(`/api/attachments/${uploadId}/complete`, '{}', 'application/json', signal), signal);
    return await completeRes.json();
  } catch (err) {
    if (!signal?.aborted) log.error('upload failed', err, { uploadId, bytes: file.size, type: file.type, chunks: totalChunks });
    fetch(`/api/attachments/${uploadId}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    throw err;
  }
}

/** Uploads the file without publishing it; the message that carries it is
 * created later, with the whole batch, by one correlated chat send. */
export async function stageFileInChunks(options: UploadRun): Promise<StagedFile> {
  const body = await runUpload(options) as { staged: StagedFile };
  return body.staged;
}

/** Drops a staged file the user gave up on; best effort — expiry cleans up otherwise. */
export function discardStagedFile(id: string): void {
  fetch(`/api/attachments/${id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
}

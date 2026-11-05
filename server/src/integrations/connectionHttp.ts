export class ConnectionFetchError extends Error {
  readonly code: string;
  readonly retryAfterMs: number;
  constructor(code: string, retryAfterMs = 0) { super(code); this.code = code; this.retryAfterMs = retryAfterMs; }
}
export type RequestText = (url: string, init?: RequestInit) => Promise<string>;
export type RequestJson = (url: string, init?: RequestInit) => Promise<unknown>;
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConnectionFetchError('invalid_response');
  return value as Record<string, unknown>;
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new ConnectionFetchError('invalid_response');
  return value;
}
export function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 512) : null;
}
export function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}
export function imageUrl(value: unknown, host: string): string | null {
  if (typeof value !== 'string') return null;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === host && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
export async function fetchConnectionText(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const response = await fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    if (!response.ok) {
      const retry = response.headers.get('retry-after');
      const reset = response.headers.get('x-ratelimit-reset');
      const retryAfterMs = retry ? (Number.isFinite(Number(retry)) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : reset ? Number(reset) * 1000 - Date.now() : 0;
      const limited = response.status === 429 || (response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || retry !== null));
      await response.body?.cancel();
      throw new ConnectionFetchError(limited ? 'rate_limited' : response.status === 404 ? 'not_found' : response.status === 403 ? 'private' : 'unavailable', Number.isFinite(retryAfterMs) ? Math.max(0, retryAfterMs) : 0);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new ConnectionFetchError('invalid_response');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2 * 1024 * 1024) { await reader.cancel(); throw new ConnectionFetchError('invalid_response'); }
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    if (error instanceof ConnectionFetchError) throw error;
    throw new ConnectionFetchError(error instanceof SyntaxError ? 'invalid_response' : 'unavailable');
  }
}

export async function fetchConnectionJson(url: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<unknown> {
  const text = await fetchConnectionText(url, init, fetcher);
  try { return JSON.parse(text) as unknown; }
  catch { throw new ConnectionFetchError('invalid_response'); }
}

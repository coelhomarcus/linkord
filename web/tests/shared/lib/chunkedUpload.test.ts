import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageFileInChunks } from '@/shared/lib/chunkedUpload';
import { readVideoDimensions } from '@/shared/lib/videoDimensions';

vi.mock('@/shared/lib/videoDimensions', () => ({ readVideoDimensions: vi.fn(async () => null) }));

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('stageFileInChunks', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('new-upload rate limit (429): waits for Retry-After and retries, without failing the file', async () => {
    const calls: string[] = [];
    let inits = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/attachments/init') {
        inits++;
        return inits === 1
          ? json(429, { error: { code: 'rate_limited', message: 'slow down' } }, { 'Retry-After': '7' })
          : json(201, { uploadId: 'u1', chunkSize: 10, totalChunks: 1 });
      }
      if (url.endsWith('/chunk/0')) return json(200, { received: 0 });
      return json(201, { staged: { id: 'u1', name: 'a.pdf', mime: 'application/pdf', size: 3 } });
    }));

    const promise = stageFileInChunks({ conversationId: 'c', file: new File(['abc'], 'a.pdf', { type: 'application/pdf' }) });
    await vi.advanceTimersByTimeAsync(6_900);
    expect(inits).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toMatchObject({ id: 'u1' });
    expect(inits).toBe(2);
  });

  describe('the server restarting mid-upload (a deploy)', () => {
    const file = () => new File(['abcdef'], 'a.bin', { type: 'application/octet-stream' });
    const proxyNotFound = () => new Response('404 page not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });

    // the server is "down" for the first `downMs` of fake time: requests fail like they do during a deploy
    function serverDownFor(downMs: number, failure: () => Promise<Response>) {
      const startedAt = Date.now();
      const calls: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        calls.push(url);
        if (Date.now() - startedAt < downMs) return failure();
        if (url === '/api/attachments/init') return json(201, { uploadId: 'u1', chunkSize: 3, totalChunks: 2 });
        if (url.includes('/chunk/')) return json(200, { received: 0 });
        return json(201, { staged: { id: 'u1', name: 'a.bin', mime: 'application/octet-stream', size: 6 } });
      }));
      return calls;
    }

    it('keeps retrying through a 30-second outage and finishes the upload', async () => {
      serverDownFor(30_000, () => Promise.reject(new TypeError('Failed to fetch')));
      const promise = stageFileInChunks({ conversationId: 'c', file: file() });
      await vi.advanceTimersByTimeAsync(40_000);
      await expect(promise).resolves.toMatchObject({ id: 'u1' });
    });

    it('treats the proxy answering for a missing app (404 without an app error) as an outage', async () => {
      serverDownFor(10_000, async () => proxyNotFound());
      const promise = stageFileInChunks({ conversationId: 'c', file: file() });
      await vi.advanceTimersByTimeAsync(20_000);
      await expect(promise).resolves.toMatchObject({ id: 'u1' });
    });

    it('gives up once the server has been away longer than the outage window', async () => {
      const calls = serverDownFor(Number.POSITIVE_INFINITY, () => Promise.reject(new TypeError('Failed to fetch')));
      const promise = stageFileInChunks({ conversationId: 'c', file: file() });
      const outcome = expect(promise).rejects.toBeInstanceOf(TypeError);
      await vi.advanceTimersByTimeAsync(70_000);
      await outcome;
      expect(calls.length).toBeGreaterThan(5);
    });

    it('an error from the app itself still fails at once', async () => {
      const fetchMock = vi.fn(async () => json(404, { error: { code: 'upload_not_found', message: 'gone' } }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(stageFileInChunks({ conversationId: 'c', file: file() })).rejects.toMatchObject({ status: 404, code: 'upload_not_found' });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it('a definitive error on init (403) is not retried', async () => {
    const fetchMock = vi.fn(async () => json(403, { error: { code: 'relationship_required', message: 'friends only' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(stageFileInChunks({ conversationId: 'c', file: new File(['a'], 'a.pdf') })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('a video', () => {
    function initBodies(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown>[] {
      return fetchMock.mock.calls
        .filter(([url]) => url === '/api/attachments/init')
        .map(([, init]) => JSON.parse((init as RequestInit).body as string));
    }

    function serverAccepting() {
      return vi.fn(async (url: string, _init?: RequestInit) => {
        if (url === '/api/attachments/init') return json(201, { uploadId: 'u1', chunkSize: 10, totalChunks: 1 });
        if (url.includes('/chunk/')) return json(200, { received: 0 });
        return json(201, { staged: { id: 'u1', name: 'clip.mp4', mime: 'video/mp4', size: 3, width: 1080, height: 1920 } });
      });
    }

    it('sends the size the browser read with init', async () => {
      vi.mocked(readVideoDimensions).mockResolvedValueOnce({ width: 1080, height: 1920 });
      const fetchMock = serverAccepting();
      vi.stubGlobal('fetch', fetchMock);
      const staged = await stageFileInChunks({ conversationId: 'c', file: new File(['abc'], 'clip.mp4', { type: 'video/mp4' }) });
      expect(initBodies(fetchMock)).toEqual([expect.objectContaining({ video: { width: 1080, height: 1920 } })]);
      expect(staged).toMatchObject({ width: 1080, height: 1920 });
    });

    it('uploads without a size when the browser cannot read one', async () => {
      vi.mocked(readVideoDimensions).mockResolvedValueOnce(null);
      const fetchMock = serverAccepting();
      vi.stubGlobal('fetch', fetchMock);
      await stageFileInChunks({ conversationId: 'c', file: new File(['abc'], 'clip.webm', { type: 'video/webm' }) });
      expect(initBodies(fetchMock)[0]).not.toHaveProperty('video');
    });

    it('does not read anything that is not a video', async () => {
      vi.mocked(readVideoDimensions).mockClear();
      vi.stubGlobal('fetch', serverAccepting());
      await stageFileInChunks({ conversationId: 'c', file: new File(['abc'], 'a.pdf', { type: 'application/pdf' }) });
      expect(readVideoDimensions).not.toHaveBeenCalled();
    });
  });
});

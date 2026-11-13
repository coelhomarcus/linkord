import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVideoDimensions } from '@/shared/lib/videoDimensions';

describe('readVideoDimensions', () => {
  let video: HTMLVideoElement;
  const revoke = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:clip'), revokeObjectURL: revoke }));
    const create = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const element = create(tag, options);
      if (tag === 'video') {
        video = element as HTMLVideoElement;
        vi.spyOn(video, 'load').mockImplementation(() => {});
      }
      return element;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    revoke.mockClear();
  });

  function loadMetadata(width: number, height: number) {
    Object.defineProperty(video, 'videoWidth', { value: width });
    Object.defineProperty(video, 'videoHeight', { value: height });
    video.dispatchEvent(new Event('loadedmetadata'));
  }

  it('reads the size from the metadata and lets the file go', async () => {
    const promise = readVideoDimensions(new Blob(['x']));
    expect(video.preload).toBe('metadata');
    expect(video.muted).toBe(true);
    loadMetadata(720, 1280);
    await expect(promise).resolves.toEqual({ width: 720, height: 1280 });
    expect(revoke).toHaveBeenCalledWith('blob:clip');
  });

  it('gives no size for a video without a picture (audio in a video container)', async () => {
    const promise = readVideoDimensions(new Blob(['x']));
    loadMetadata(0, 0);
    await expect(promise).resolves.toBeNull();
  });

  it('gives no size when the browser cannot decode the file', async () => {
    const promise = readVideoDimensions(new Blob(['x']));
    video.dispatchEvent(new Event('error'));
    await expect(promise).resolves.toBeNull();
    expect(revoke).toHaveBeenCalled();
  });

  it('gives up after the timeout', async () => {
    const promise = readVideoDimensions(new Blob(['x']), 500);
    await vi.advanceTimersByTimeAsync(500);
    await expect(promise).resolves.toBeNull();
    expect(revoke).toHaveBeenCalled();
  });
});

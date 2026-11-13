export interface VideoDimensions {
  width: number;
  height: number;
}

const READ_TIMEOUT_MS = 3_000;

/** The size a video file plays at, read by the browser from its metadata
 * before the upload starts. The server has no video decoder, so this is what
 * lets every reader's player reserve the right box before loading anything.
 * `null` when the browser can't read it (an unsupported codec) or takes too
 * long: the upload goes ahead without a size. */
export function readVideoDimensions(file: Blob, timeoutMs = READ_TIMEOUT_MS): Promise<VideoDimensions | null> {
  if (typeof URL.createObjectURL !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    let timer = 0;

    function finish(result: VideoDimensions | null) {
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(result);
    }

    timer = window.setTimeout(() => finish(null), timeoutMs);
    video.preload = 'metadata';
    video.muted = true;
    video.addEventListener('loadedmetadata', () => {
      const { videoWidth: width, videoHeight: height } = video;
      finish(width > 0 && height > 0 ? { width, height } : null);
    }, { once: true });
    video.addEventListener('error', () => finish(null), { once: true });
    video.src = url;
  });
}

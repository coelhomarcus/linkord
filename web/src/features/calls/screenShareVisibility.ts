import type { ElementInfo, RemoteVideoTrack } from 'livekit-client';
import { fullscreenElement, subscribeFullscreen } from '@/shared/lib/fullscreen';

/** LiveKit aggregates these measurements and chooses the layer. Supply the
 * native PiP window's size and exclude tiles behind Overcord's fullscreen. */
export function observeScreenShareVideo(track: RemoteVideoTrack, video: HTMLVideoElement): void {
  if (!track.isAdaptiveStream || typeof track.observeElementInfo !== 'function') return;

  const document = video.ownerDocument;
  const window = document.defaultView;
  if (!window) return;

  let inViewport = false;
  let pipWindow: PictureInPictureWindow | undefined;
  let pixelDensity: MediaQueryList | undefined;
  let unsubscribeFullscreen: (() => void) | undefined;

  function dimensions() {
    const inPage = info.visible && document.visibilityState !== 'hidden';
    const width = inPage ? video.clientWidth : 0;
    const height = inPage ? video.clientHeight : 0;
    if (info.pictureInPicture) {
      const pipWidth = pipWindow?.width ?? video.clientWidth;
      const pipHeight = pipWindow?.height ?? video.clientHeight;
      if (pipWidth + pipHeight > width + height) return { width: pipWidth, height: pipHeight };
    }
    return { width, height };
  }

  function resize() {
    info.handleResize?.();
  }

  function visibilityChanged() {
    info.visibilityChangedAt = Date.now();
    info.handleVisibilityChanged?.();
    resize();
  }

  function watchPixelDensity() {
    pixelDensity?.removeEventListener('change', watchPixelDensity);
    pixelDensity = window?.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`);
    pixelDensity?.addEventListener('change', watchPixelDensity);
    resize();
  }

  function leavePictureInPicture() {
    pipWindow?.removeEventListener('resize', resize);
    pipWindow = undefined;
    visibilityChanged();
  }

  function enterPictureInPicture(event: PictureInPictureEvent) {
    pipWindow?.removeEventListener('resize', resize);
    pipWindow = event.pictureInPictureWindow;
    pipWindow.addEventListener('resize', resize);
    visibilityChanged();
  }

  const intersection = new IntersectionObserver(([entry]) => {
    inViewport = !!entry?.isIntersecting;
    visibilityChanged();
  });
  const size = new ResizeObserver(resize);
  const info: ElementInfo = {
    element: video,
    width: () => dimensions().width,
    height: () => dimensions().height,
    get visible() {
      const fullscreen = fullscreenElement();
      return inViewport && (!fullscreen || fullscreen.contains(video));
    },
    get pictureInPicture() {
      return document.pictureInPictureElement === video;
    },
    visibilityChangedAt: Date.now(),
    observe() {
      intersection.observe(video);
      size.observe(video);
      unsubscribeFullscreen = subscribeFullscreen(visibilityChanged);
      document.addEventListener('visibilitychange', resize);
      video.addEventListener('enterpictureinpicture', enterPictureInPicture);
      video.addEventListener('leavepictureinpicture', leavePictureInPicture);
      watchPixelDensity();
    },
    stopObserving() {
      intersection.disconnect();
      size.disconnect();
      unsubscribeFullscreen?.();
      document.removeEventListener('visibilitychange', resize);
      pixelDensity?.removeEventListener('change', watchPixelDensity);
      video.removeEventListener('enterpictureinpicture', enterPictureInPicture);
      video.removeEventListener('leavepictureinpicture', leavePictureInPicture);
      pipWindow?.removeEventListener('resize', resize);
    },
  };

  // Register before attach() so the SDK uses this observer for the element and
  // releases it through its normal detach path.
  track.observeElementInfo(info);
}

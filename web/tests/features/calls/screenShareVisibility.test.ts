import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElementInfo, RemoteVideoTrack } from 'livekit-client';
import { observeScreenShareVideo } from '@/features/calls/screenShareVisibility';

describe('screen share visibility', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps an unfocused window visible, excludes covered tiles, and measures native PiP', () => {
    let intersection: IntersectionObserverCallback | undefined;
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersection = callback; }
      observe() {}
      disconnect() {}
    });
    const video = document.createElement('video');
    Object.defineProperties(video, { clientWidth: { value: 640 }, clientHeight: { value: 360 } });
    const fullscreen = document.createElement('div');
    let fullscreenTarget: HTMLElement | null = null;
    let pipElement: HTMLVideoElement | null = null;
    let pageVisibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => pageVisibility);
    const observeElementInfo = vi.fn<(info: ElementInfo) => void>();
    const track = { isAdaptiveStream: true, observeElementInfo } as unknown as RemoteVideoTrack;

    const previousFullscreen = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const previousPip = Object.getOwnPropertyDescriptor(document, 'pictureInPictureElement');
    Object.defineProperties(document, {
      fullscreenElement: { configurable: true, get: () => fullscreenTarget },
      pictureInPictureElement: { configurable: true, get: () => pipElement },
    });
    observeScreenShareVideo(track, video);
    const info = observeElementInfo.mock.calls[0]![0];
    const handleResize = vi.fn();
    info.handleResize = handleResize;
    info.observe();
    try {
      intersection?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      window.dispatchEvent(new Event('blur'));
      expect(info.visible).toBe(true);
      expect(info.width()).toBe(640);

      fullscreenTarget = fullscreen;
      document.dispatchEvent(new Event('fullscreenchange'));
      expect(info.visible).toBe(false);
      expect(info.width()).toBe(0);

      pageVisibility = 'hidden';
      pipElement = video;
      const pipWindow = Object.assign(new EventTarget(), { width: 320, height: 180 });
      video.dispatchEvent(Object.assign(new Event('enterpictureinpicture'), { pictureInPictureWindow: pipWindow }));
      expect(info.pictureInPicture).toBe(true);
      expect([info.width(), info.height()]).toEqual([320, 180]);

      handleResize.mockClear();
      Object.assign(pipWindow, { width: 800, height: 450 });
      pipWindow.dispatchEvent(new Event('resize'));
      expect(handleResize).toHaveBeenCalledOnce();
      expect([info.width(), info.height()]).toEqual([800, 450]);

      pipElement = null;
      video.dispatchEvent(new Event('leavepictureinpicture'));
      expect(info.pictureInPicture).toBe(false);
      expect(info.width()).toBe(0);
    } finally {
      info.stopObserving();
      if (previousFullscreen) Object.defineProperty(document, 'fullscreenElement', previousFullscreen);
      else Reflect.deleteProperty(document, 'fullscreenElement');
      if (previousPip) Object.defineProperty(document, 'pictureInPictureElement', previousPip);
      else Reflect.deleteProperty(document, 'pictureInPictureElement');
    }
  });
});

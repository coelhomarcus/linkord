import { useEffect } from 'react';
import type { RefObject } from 'react';

/** Pauses a video when its tab goes to the background: nobody is watching it
 * there, and it keeps downloading and decoding. A video in picture-in-picture
 * is still on screen, so it keeps playing. */
export function useHiddenTabPause(videoRef: RefObject<HTMLVideoElement | null>) {
  useEffect(() => {
    function onVisibilityChange() {
      const video = videoRef.current;
      if (!video || document.visibilityState !== 'hidden') return;
      if (document.pictureInPictureElement === video) return;
      if (!video.paused) video.pause();
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [videoRef]);
}

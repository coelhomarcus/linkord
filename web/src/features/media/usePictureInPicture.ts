import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

/** The browser's own floating window for a video. `supported` stays false
 * where the API is missing or turned off (Firefox, some embedded views), so no
 * button is drawn for it; `active` follows the window, including when it is
 * closed from its own controls. */
export function usePictureInPicture(videoRef: RefObject<HTMLVideoElement | null>) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setSupported(document.pictureInPictureEnabled === true && !video.disablePictureInPicture);
    setActive(document.pictureInPictureElement === video);
    const enter = () => setActive(true);
    const leave = () => setActive(false);
    video.addEventListener('enterpictureinpicture', enter);
    video.addEventListener('leavepictureinpicture', leave);
    return () => {
      video.removeEventListener('enterpictureinpicture', enter);
      video.removeEventListener('leavepictureinpicture', leave);
    };
  }, [videoRef]);

  function toggle() {
    const video = videoRef.current;
    if (!video) return;
    // refused without a user gesture or before metadata: nothing to undo
    const request = document.pictureInPictureElement === video ? document.exitPictureInPicture() : video.requestPictureInPicture();
    void Promise.resolve(request).catch(() => {});
  }

  return { supported, active, toggle };
}

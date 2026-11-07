/** The slice of a LiveKit publication these checks need. A camera that is
 * turned off stays published and muted — `setCameraEnabled(false)` does not
 * remove it — so "the publication exists" is not "it is transmitting". */
export interface MediaPublication {
  isMuted: boolean;
  track?: { mediaStreamTrack?: { readyState?: string } } | null;
}

/** True only while the camera capture is published, unmuted and not ended. */
export function cameraIsTransmitting(publication: MediaPublication | undefined): boolean {
  if (!publication || publication.isMuted) return false;
  return publication.track?.mediaStreamTrack?.readyState !== 'ended';
}

/** A paused share is muted on purpose and still a share. An ended capture
 * (the browser's own stop) is not, even in the moment before it unpublishes. */
export function screenIsSharing(publication: MediaPublication | undefined): boolean {
  if (!publication) return false;
  return publication.track?.mediaStreamTrack?.readyState !== 'ended';
}

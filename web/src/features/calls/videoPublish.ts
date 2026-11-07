import { VideoPreset, VideoPresets } from 'livekit-client';
import type { TrackPublishOptions, VideoCaptureOptions } from 'livekit-client';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import type { ShareQualityId } from './shareQualityPresets';

/**
 * Camera and screen share both go out through LiveKit, but the SDK does not
 * treat them the same. A camera that only sets `videoEncoding` still
 * simulcasts, and the layers the SDK invents are 180p at 20 fps / 160 kbps
 * and 360p at 20 fps / 450 kbps. Its default degradation preference for a
 * camera is `maintain-framerate`, so the first thing a constrained call
 * gives up is resolution. Screen share opts out of simulcast, sends one
 * layer at 4.5–6 Mbps and keeps resolution. That is why a share stays sharp
 * in the same tile a camera looks soft in.
 *
 * Camera keeps simulcast: several faces can be on screen, and dynacast stops
 * encoding a layer nobody is watching. The layers are explicit, all 30 fps,
 * and the floor is 360p — a 720p webcam never reaches the SDK's third layer
 * (that needs a 960px short side), so an 180p floor is what a grid tile
 * actually receives. Screen share stays one layer: a half-resolution
 * simulcast layer is what a game tile would be subscribed to.
 */

/** Ideal capture. The browser negotiates down when the webcam cannot do it. */
export const CAMERA_CAPTURE_RESOLUTION: NonNullable<VideoCaptureOptions['resolution']> = {
  width: 1920,
  height: 1080,
  frameRate: 30,
};

/**
 * Lowest to highest, excluding the full capture (that layer is
 * `videoEncoding`). 360p is the floor a small tile subscribes to. 720p is
 * the middle step, published only when the capture is tall enough for the
 * SDK to keep three layers.
 */
export const CAMERA_SIMULCAST_LAYERS = [
  new VideoPreset(640, 360, 900_000, 30),
  VideoPresets.h720,
];

/** Faces: keep the picture sharp and let the frame rate give first. */
export const CAMERA_CONTENT_HINT = 'detail';

export function cameraCaptureOptions(deviceId: string | null): VideoCaptureOptions {
  return {
    resolution: CAMERA_CAPTURE_RESOLUTION,
    ...(deviceId ? { deviceId } : {}),
  };
}

export function cameraPublishOptions(): TrackPublishOptions {
  return {
    // LiveKit's own 1080p30 operating point. A cap: a 720p webcam is not
    // upscaled, it just stops being crushed at the old 1.7 Mbps ceiling.
    videoEncoding: { ...VideoPresets.h1080.encoding },
    videoSimulcastLayers: CAMERA_SIMULCAST_LAYERS,
    simulcast: true,
    degradationPreference: 'maintain-resolution',
  };
}

/** `contentHint` is applied by the SDK for screen share only, so the camera sets it on the track it just published. */
export function applyCameraContentHint(track: MediaStreamTrack | undefined): void {
  if (track && 'contentHint' in track) track.contentHint = CAMERA_CONTENT_HINT;
}

export function screenSharePublishOptions(qualityId: ShareQualityId): TrackPublishOptions {
  const quality = SHARE_QUALITY_PRESETS[qualityId];
  return {
    screenShareEncoding: quality.encoding,
    degradationPreference: quality.degradationPreference,
    simulcast: false,
  };
}

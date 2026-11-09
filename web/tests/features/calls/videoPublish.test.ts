import { describe, expect, it } from 'vitest';
import { VideoPresets } from 'livekit-client';
import {
  CAMERA_CAPTURE_RESOLUTION, CAMERA_CONTENT_HINT, CAMERA_SIMULCAST_LAYERS,
  applyCameraContentHint, cameraCaptureOptions, cameraPublishOptions, screenSharePublishOptions,
} from '@/features/calls/videoPublish';
import { SHARE_QUALITY_PRESETS } from '@/features/calls/shareQualityPresets';
import type { ShareQualityId } from '@/features/calls/shareQualityPresets';

describe('video publish options', () => {
  it('captures the camera at an ideal 1080p30 and publishes LiveKit\'s 1080p encoding', () => {
    expect(CAMERA_CAPTURE_RESOLUTION).toEqual({ width: 1920, height: 1080, frameRate: 30 });
    expect(cameraCaptureOptions(null)).toEqual({ resolution: CAMERA_CAPTURE_RESOLUTION });
    expect(cameraCaptureOptions('cam-1')).toEqual({ resolution: CAMERA_CAPTURE_RESOLUTION, deviceId: 'cam-1' });

    const publish = cameraPublishOptions();
    expect(publish.videoEncoding).toEqual(VideoPresets.h1080.encoding);
    expect(publish.videoEncoding?.maxBitrate).toBeGreaterThan(VideoPresets.h720.encoding.maxBitrate!);
    expect(publish.simulcast).toBe(true);
    expect(publish.degradationPreference).toBe('maintain-resolution');
  });

  it('keeps every camera simulcast layer at 30fps, with a 360p floor above the SDK default', () => {
    expect(CAMERA_SIMULCAST_LAYERS.map((layer) => ({
      width: layer.width,
      height: layer.height,
      maxBitrate: layer.encoding.maxBitrate,
      maxFramerate: layer.encoding.maxFramerate,
    }))).toEqual([
      { width: 640, height: 360, maxBitrate: 900_000, maxFramerate: 30 },
      { width: VideoPresets.h720.width, height: VideoPresets.h720.height, maxBitrate: VideoPresets.h720.encoding.maxBitrate, maxFramerate: 30 },
    ]);
    expect(CAMERA_SIMULCAST_LAYERS[0]!.encoding.maxBitrate).toBeGreaterThan(VideoPresets.h360.encoding.maxBitrate!);
    expect(CAMERA_SIMULCAST_LAYERS[0]!.encoding.maxFramerate).toBeGreaterThan(VideoPresets.h360.encoding.maxFramerate!);
  });

  it('marks a published camera track as detail, which the SDK only does for screen share', () => {
    const track = { contentHint: '' };
    applyCameraContentHint(track as unknown as MediaStreamTrack);
    expect(track.contentHint).toBe(CAMERA_CONTENT_HINT);
    expect(() => applyCameraContentHint(undefined)).not.toThrow();
  });

  it('leaves screen share as one layer at every preset', () => {
    for (const id of Object.keys(SHARE_QUALITY_PRESETS) as ShareQualityId[]) {
      const quality = SHARE_QUALITY_PRESETS[id];
      expect(screenSharePublishOptions(id)).toEqual({
        screenShareEncoding: quality.encoding,
        degradationPreference: quality.degradationPreference,
        simulcast: false,
      });
    }
  });
});

import type { ScreenShareCaptureOptions, TrackPublishOptions, VideoEncoding } from 'livekit-client';

export type ShareQualityId = 'game1440' | 'screen1440' | 'game1080' | 'screen1080';

interface ShareQualityPreset {
  resolution: { width: number; height: number; frameRate: number };
  contentHint: NonNullable<ScreenShareCaptureOptions['contentHint']>;
  degradationPreference: NonNullable<TrackPublishOptions['degradationPreference']>;
  encoding: VideoEncoding;
}

// Paid-tier operating points, in menu order. The SDK's named screen-share
// presets top out at 1080p30 / 5 Mbps and, unless passed as
// `screenShareEncoding`, are ignored in favor of 1080p15, so every preset
// sets its own encoding. Bitrates scale with the pixel rate (6 Mbps at
// 1440p60, 5 Mbps at 1440p30 and 1080p60, 4.5 Mbps at 1080p30).
// 60 fps presets are for games: `motion` stays set even though a native
// capture would be the only place some clients apply it, because this app
// only captures through the browser, and without the hint the encoder keeps
// sharpness and drops the frames a game needs. 30 fps presets are for text
// and keep resolution instead.
export const SHARE_QUALITY_PRESETS: Record<ShareQualityId, ShareQualityPreset> = {
  game1440: {
    resolution: { width: 2560, height: 1440, frameRate: 60 },
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate',
    encoding: { maxBitrate: 6_000_000, maxFramerate: 60, priority: 'high' },
  },
  screen1440: {
    resolution: { width: 2560, height: 1440, frameRate: 30 },
    contentHint: 'text',
    degradationPreference: 'maintain-resolution',
    encoding: { maxBitrate: 5_000_000, maxFramerate: 30, priority: 'high' },
  },
  game1080: {
    resolution: { width: 1920, height: 1080, frameRate: 60 },
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate',
    encoding: { maxBitrate: 5_000_000, maxFramerate: 60, priority: 'high' },
  },
  screen1080: {
    resolution: { width: 1920, height: 1080, frameRate: 30 },
    contentHint: 'text',
    degradationPreference: 'maintain-resolution',
    encoding: { maxBitrate: 4_500_000, maxFramerate: 30, priority: 'high' },
  },
};

export const DEFAULT_SHARE_QUALITY: ShareQualityId = 'screen1080';

// Ids saved by builds that had only two presets, so a stored choice survives.
const LEGACY_SHARE_QUALITY: Record<string, ShareQualityId> = { game: 'game1440', screen: 'screen1080' };

export function isShareQualityId(value: string): value is ShareQualityId {
  return Object.hasOwn(SHARE_QUALITY_PRESETS, value);
}

/** A stored id as a current one, or null when it names no preset. */
export function parseShareQualityId(value: string): ShareQualityId | null {
  if (isShareQualityId(value)) return value;
  return Object.hasOwn(LEGACY_SHARE_QUALITY, value) ? LEGACY_SHARE_QUALITY[value] : null;
}

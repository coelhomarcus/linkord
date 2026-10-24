import type { ScreenShareCaptureOptions, TrackPublishOptions, VideoEncoding } from 'livekit-client';

export type ShareQualityId = 'game' | 'screen';

interface ShareQualityPreset {
  label: string;
  resolution: { width: number; height: number; frameRate: number };
  contentHint: NonNullable<ScreenShareCaptureOptions['contentHint']>;
  degradationPreference: NonNullable<TrackPublishOptions['degradationPreference']>;
  encoding: VideoEncoding;
}

// Paid-tier operating points for the two kinds of screen content. The SDK's
// named screen-share presets top out at 1080p30 / 5 Mbps and, unless passed
// as `screenShareEncoding`, are ignored in favor of 1080p15. Bitrates here
// are the floors that preset table uses at these sizes (6 Mbps at 1440p60,
// 4.5 Mbps at 1080p30). `motion` stays set for games even though a native
// capture would be the only place some clients apply it: this app only
// captures through the browser, and without the hint the encoder keeps
// sharpness and drops the frames a game needs.
export const SHARE_QUALITY_PRESETS: Record<ShareQualityId, ShareQualityPreset> = {
  game: {
    label: 'Jogo (1440p, 60 fps)',
    resolution: { width: 2560, height: 1440, frameRate: 60 },
    contentHint: 'motion',
    degradationPreference: 'maintain-framerate',
    encoding: { maxBitrate: 6_000_000, maxFramerate: 60, priority: 'high' },
  },
  screen: {
    label: 'Tela (1080p, 30 fps)',
    resolution: { width: 1920, height: 1080, frameRate: 30 },
    contentHint: 'text',
    degradationPreference: 'maintain-resolution',
    encoding: { maxBitrate: 4_500_000, maxFramerate: 30, priority: 'high' },
  },
};

export const DEFAULT_SHARE_QUALITY: ShareQualityId = 'game';

export function isShareQualityId(value: string): value is ShareQualityId {
  return value in SHARE_QUALITY_PRESETS;
}

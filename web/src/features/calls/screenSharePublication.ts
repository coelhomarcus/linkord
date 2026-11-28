import type { TrackPublication } from 'livekit-client';

type ScreenPublication = Pick<TrackPublication, 'trackName' | 'trackSid'>;

// The SDK preserves publish options on reconnect and exposes the name before
// subscribing. Separate names keep the two sources independently addressable.
const SHARE_NAME = /^overcord-screen-v1:(video|audio):([0-9a-f-]{36})$/;

export function screenCaptureId(name: string | undefined, kind: 'video' | 'audio'): string | null {
  const match = name?.match(SHARE_NAME);
  return match?.[1] === kind ? match[2]! : null;
}

export function screenTrackName(captureId: string, kind: 'video' | 'audio'): string {
  return `overcord-screen-v1:${kind}:${captureId}`;
}

export function screenShareId(video: ScreenPublication | undefined): string | null {
  if (!video) return null;
  const captureId = screenCaptureId(video.trackName, 'video');
  return captureId ? `capture:${captureId}` : `track:${video.trackSid}`;
}

export function screenAudioMatches(video: ScreenPublication | undefined, audio: ScreenPublication | undefined): boolean {
  if (!video || !audio) return false;
  return screenCaptureId(video.trackName, 'video') === screenCaptureId(audio.trackName, 'audio');
}

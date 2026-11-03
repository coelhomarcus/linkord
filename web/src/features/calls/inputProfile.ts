import { Track } from 'livekit-client';
import type { AudioCaptureOptions, LocalAudioTrack, Room } from 'livekit-client';
import type { InputProfile } from './audioPreferences';

// The browser's own processing, not a bundled denoiser: "voice isolation" is
// LiveKit's capture defaults, "studio" turns all of it off.
const PROFILE_CONSTRAINTS: Record<InputProfile, AudioCaptureOptions> = {
  'voice-isolation': { echoCancellation: true, noiseSuppression: true, autoGainControl: true, voiceIsolation: true },
  studio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, voiceIsolation: false },
};

/** Only what has to be passed when first capturing — the voice isolation
 * profile already is LiveKit's default. */
export function captureOptionsForProfile(profile: InputProfile): AudioCaptureOptions {
  return profile === 'studio' ? PROFILE_CONSTRAINTS.studio : {};
}

export async function applyInputProfile(room: Room, profile: InputProfile): Promise<void> {
  const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalAudioTrack | undefined;
  if (!track) return;
  // restartTrack drops every constraint but the device when no deviceId is
  // given, so the active one is passed back explicitly.
  await track.restartTrack({ deviceId: room.getActiveDevice('audioinput'), ...PROFILE_CONSTRAINTS[profile] });
}

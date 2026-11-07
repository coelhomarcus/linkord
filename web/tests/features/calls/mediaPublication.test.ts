import { describe, expect, it } from 'vitest';
import { cameraIsTransmitting, screenIsSharing } from '@/features/calls/mediaPublication';

const live = { mediaStreamTrack: { readyState: 'live' } };

describe('cameraIsTransmitting', () => {
  it('is off when there is no publication, or it is muted, or the capture has ended', () => {
    expect(cameraIsTransmitting(undefined)).toBe(false);
    expect(cameraIsTransmitting({ isMuted: true, track: live })).toBe(false);
    expect(cameraIsTransmitting({ isMuted: false, track: { mediaStreamTrack: { readyState: 'ended' } } })).toBe(false);
  });

  it('is on only while the published capture is unmuted and live', () => {
    expect(cameraIsTransmitting({ isMuted: false, track: live })).toBe(true);
  });
});

describe('screenIsSharing', () => {
  it('stays on while the preview is paused, and off once the capture ends', () => {
    expect(screenIsSharing(undefined)).toBe(false);
    expect(screenIsSharing({ isMuted: true, track: live })).toBe(true);
    expect(screenIsSharing({ isMuted: false, track: { mediaStreamTrack: { readyState: 'ended' } } })).toBe(false);
  });
});

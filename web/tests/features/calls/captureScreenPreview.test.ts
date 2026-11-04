import { describe, expect, it } from 'vitest';
import type { Room } from 'livekit-client';
import { captureScreenPreview } from '@/features/calls/captureScreenPreview';

function roomSharing(track: { readyState: string } | null): Room {
  return {
    localParticipant: { getTrackPublication: () => (track ? { track: { mediaStreamTrack: track } } : undefined) },
  } as unknown as Room;
}

describe('captureScreenPreview', () => {
  it('nothing shared, nothing to send', async () => {
    expect(await captureScreenPreview(roomSharing(null))).toBeNull();
  });

  it('a share that already ended is not drawn', async () => {
    expect(await captureScreenPreview(roomSharing({ readyState: 'ended' }))).toBeNull();
  });
});

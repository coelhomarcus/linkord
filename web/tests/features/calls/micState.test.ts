import { describe, expect, it } from 'vitest';
import { participantMicMuted } from '@/features/calls/micState';

describe('participantMicMuted', () => {
  it('a mic that is still starting is not muted unless the join asked for it', () => {
    expect(participantMicMuted({ micActivated: false, micMuted: false, micStarting: true })).toBe(false);
    expect(participantMicMuted({ micActivated: false, micMuted: true, micStarting: true })).toBe(true);
  });

  it('without a published mic, and not starting, it reads as muted (also from an older server)', () => {
    expect(participantMicMuted({ micActivated: false, micMuted: false, micStarting: false })).toBe(true);
    expect(participantMicMuted({ micActivated: false, micMuted: true })).toBe(true);
  });

  it('a published mic reads as its own mute', () => {
    expect(participantMicMuted({ micActivated: true, micMuted: false, micStarting: true })).toBe(false);
    expect(participantMicMuted({ micActivated: true, micMuted: true })).toBe(true);
  });
});

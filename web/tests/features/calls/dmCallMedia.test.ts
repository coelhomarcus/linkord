import { describe, expect, it } from 'vitest';
import type { TileDescriptor } from '@/features/calls/tileTypes';
import { dmCallHasMedia } from '@/features/calls/dmCallMedia';

function avatar(loading = false): TileDescriptor {
  return { key: 'p:participant', participantId: 'p', kind: 'avatar', loading, paused: false };
}

describe('dmCallHasMedia', () => {
  it('stays on avatars until a camera or a screen exists', () => {
    expect(dmCallHasMedia([avatar()])).toBe(false);
    expect(dmCallHasMedia([avatar(true)])).toBe(true);
    expect(dmCallHasMedia([{ ...avatar(), kind: 'camera', loading: false }])).toBe(true);
    expect(dmCallHasMedia([{ ...avatar(), key: 'p:screen', kind: 'screen', paused: true }])).toBe(true);
  });
});

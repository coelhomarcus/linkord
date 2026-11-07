import { describe, expect, it } from 'vitest';
import { dmAvatarSize, dmStripScale, fitDmVideos, splitDmCallMedia } from '@/features/calls/dmCallLayout';
import type { TileDescriptor } from '@/features/calls/tileTypes';

function tile(participantId: string, kind: TileDescriptor['kind'], loading = false): TileDescriptor {
  return { key: `${participantId}:${kind}`, participantId, kind, loading, paused: false };
}

describe('splitDmCallMedia', () => {
  it('plays only screens and cameras as video', () => {
    const { videos, pendingCameraIds } = splitDmCallMedia([tile('a', 'screen'), tile('a', 'avatar'), tile('b', 'camera'), tile('c', 'avatar', true)]);
    expect(videos.map((d) => `${d.participantId}:${d.kind}`)).toEqual(['a:screen', 'b:camera']);
    expect([...pendingCameraIds]).toEqual(['c']);
  });
});

describe('dmAvatarSize', () => {
  it('scales with the call height within bounds, smaller beside video', () => {
    expect(dmAvatarSize(80, false)).toBe(48);
    expect(dmAvatarSize(400, false)).toBe(96);
    expect(dmAvatarSize(400, true)).toBe(80);
  });
});

describe('fitDmVideos', () => {
  it('fits 16:9 tiles into the row left after the avatars', () => {
    const alone = fitDmVideos(1, 0, 900, 300, 80);
    expect(alone).toMatchObject({ cols: 1, tileH: 300 });
    expect(alone!.tileW).toBeCloseTo(533, 0);

    const withAvatar = fitDmVideos(1, 1, 500, 300, 80);
    // 500 - (80 + 24) leaves 396px of width, which now limits the tile
    expect(withAvatar!.tileW).toBe(396);
    expect(withAvatar!.tileH).toBe(222);
  });

  it('returns nothing without video or without room', () => {
    expect(fitDmVideos(0, 2, 900, 300, 80)).toBeNull();
    expect(fitDmVideos(1, 5, 300, 300, 80)).toBeNull();
  });
});

describe('dmStripScale', () => {
  it('keeps full size when everyone fits and shrinks to fit a short call', () => {
    // 90 + 64 + 12 gap + 8 padding = 174
    expect(dmStripScale(1, 1, 300)).toBe(1);
    expect(dmStripScale(1, 1, 174)).toBe(1);
    expect(dmStripScale(1, 1, 97)).toBeCloseTo(0.5, 5);
    expect(dmStripScale(1, 1, 20)).toBe(0.4);
  });
});

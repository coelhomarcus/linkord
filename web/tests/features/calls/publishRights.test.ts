import { describe, expect, it } from 'vitest';
import { Track } from 'livekit-client';
import { callPublishRights, mayPublish } from '@/features/calls/publishRights';
import { PERMISSIONS } from '@/features/servers/permissionBits';

// the grant carries LiveKit's protocol enum, not the client's source names
const proto = Track.sourceToProto;
const grant = (canPublish: boolean, canPublishSources: ReturnType<typeof proto>[] = []) => ({ canPublish, canPublishSources }) as never;

describe('mayPublish', () => {
  it('allows anything before LiveKit has said otherwise', () => {
    expect(mayPublish(undefined, Track.Source.Microphone)).toBe(true);
  });

  it('follows the sources of the grant, and an empty list means all of them', () => {
    expect(mayPublish(grant(true, [proto(Track.Source.Microphone)]), Track.Source.Microphone)).toBe(true);
    expect(mayPublish(grant(true, [proto(Track.Source.Microphone)]), Track.Source.Camera)).toBe(false);
    expect(mayPublish(grant(true), Track.Source.ScreenShare)).toBe(true);
    expect(mayPublish(grant(false), Track.Source.Microphone)).toBe(false);
  });
});

describe('callPublishRights', () => {
  it('reads SPEAK and STREAM from a voice channel', () => {
    expect(callPublishRights({ permissions: PERMISSIONS.CONNECT | PERMISSIONS.SPEAK })).toEqual({ canSpeak: true, canStream: false });
    expect(callPublishRights({ permissions: PERMISSIONS.CONNECT | PERMISSIONS.STREAM })).toEqual({ canSpeak: false, canStream: true });
  });

  it('lets a DM call (no bits) do everything', () => {
    expect(callPublishRights({})).toEqual({ canSpeak: true, canStream: true });
    expect(callPublishRights(null)).toEqual({ canSpeak: true, canStream: true });
  });
});

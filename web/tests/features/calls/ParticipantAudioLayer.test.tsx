import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { Room, Track } from 'livekit-client';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { fakeCallMediaRoom, fakePublication } from '@tests/fixtures/callMediaFixture';
import { initialRoomState } from '@/state/roomReducer';
import { ParticipantAudioLayer } from '@/features/calls/ParticipantAudioLayer';
import { createCallSubscriptions } from '@/features/calls/callSubscriptions';
import { saveDevicePreference } from '@/features/settings/useDevicePreference';
import type { Participant } from '@/shared/types/protocol';

function fakeParticipant(overrides: Partial<Participant> = {}): Participant {
  return {
    id: 'p-2', userId: 'u-2', name: 'Jane', displayName: 'Jane', avatar: '', avatarPoster: '', avatarColor: 'green',
    banner: '', bannerPoster: '', bio: '', profileLinks: [], role: 'user', deafened: false, callConversationId: 'conv-1',
    micActivated: true, micMuted: false, cameraOn: false, sharing: false, speaking: false,
    ...overrides,
  };
}

function fakeRoomWithScreenAudio(track?: object) {
  const media = fakeCallMediaRoom();
  const remote = media.addRemote('p-2');
  media.publish(remote, fakePublication(Track.Source.ScreenShare, 'screen'));
  if (track) media.publish(remote, fakePublication(Track.Source.ScreenShareAudio, 'audio', { track }));
  const callSubscriptions = createCallSubscriptions(media.room);
  callSubscriptions.beginCall('conv-1');
  return { livekitRoom: media.room, callSubscriptions };
}

describe('ParticipantAudioLayer — screen-share audio only registers when it actually exists', () => {
  it('without a screen audio track (nothing was shared), does not register the ":screen" key — no "audio available" just because it was requested', () => {
    const audioRegistry = { current: new Map() };
    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<ParticipantAudioLayer participantIds={['p-2']} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      ...fakeRoomWithScreenAudio(),
      audioRegistry,
    });

    expect(audioRegistry.current.has('p-2:screen')).toBe(false);
  });

  it('attaches screen audio only for a watched capture and detaches immediately on stop', () => {
    const audioRegistry = { current: new Map() };
    const participants = new Map([['p-2', fakeParticipant()]]);
    const track = { attach: vi.fn(), detach: vi.fn() };
    const fixture = fakeRoomWithScreenAudio(track);
    renderWithRoom(<ParticipantAudioLayer participantIds={['p-2']} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      ...fixture,
      audioRegistry,
    });

    expect(audioRegistry.current.has('p-2:screen')).toBe(false);
    act(() => fixture.callSubscriptions.setWatching('p-2', 'track:screen', true));
    expect(audioRegistry.current.has('p-2:screen')).toBe(true);
    act(() => fixture.callSubscriptions.setWatching('p-2', 'track:screen', false));
    expect(track.detach).toHaveBeenCalledOnce();
    expect(audioRegistry.current.has('p-2:screen')).toBe(false);
  });
});

describe('ParticipantAudioLayer — applies the saved audio output (speaker)', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    // @ts-expect-error -- jsdom doesn't have setSinkId; remove the test's fake version.
    delete HTMLMediaElement.prototype.setSinkId;
  });

  it('calls setSinkId with the saved deviceId for created audio elements', () => {
    saveDevicePreference('audiooutput', 'preferred-device');
    const setSinkId = vi.fn(async () => undefined);
    HTMLMediaElement.prototype.setSinkId = setSinkId;

    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<ParticipantAudioLayer participantIds={['p-2']} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      livekitRoom: new Room(),
    });

    expect(setSinkId).toHaveBeenCalledWith('preferred-device');
  });

  it('without a saved preference, does not call setSinkId', () => {
    const setSinkId = vi.fn(async () => undefined);
    HTMLMediaElement.prototype.setSinkId = setSinkId;

    const participants = new Map([['p-2', fakeParticipant()]]);
    renderWithRoom(<ParticipantAudioLayer participantIds={['p-2']} />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' }, participants },
      livekitRoom: new Room(),
    });

    expect(setSinkId).not.toHaveBeenCalled();
  });
});

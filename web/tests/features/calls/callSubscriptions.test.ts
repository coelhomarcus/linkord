import { describe, expect, it } from 'vitest';
import { RoomEvent, Track } from 'livekit-client';
import { createCallSubscriptions } from '@/features/calls/callSubscriptions';
import { screenShareId, screenTrackName } from '@/features/calls/screenSharePublication';
import { fakeCallMediaRoom, fakePublication } from '@tests/fixtures/callMediaFixture';

const firstCapture = '15d60604-14bc-4f23-a516-871967dac21c';
const secondCapture = '15d60604-14bc-4f23-a516-871967dac21d';

function video(sid: string, captureId = firstCapture) {
  return fakePublication(Track.Source.ScreenShare, sid, { name: screenTrackName(captureId, 'video') });
}

function audio(sid: string, captureId = firstCapture) {
  return fakePublication(Track.Source.ScreenShareAudio, sid, { name: screenTrackName(captureId, 'audio') });
}

function setup() {
  const fixture = fakeCallMediaRoom();
  const subscriptions = createCallSubscriptions(fixture.room);
  subscriptions.beginCall('voice-room');
  subscriptions.listen();
  return { ...fixture, subscriptions };
}

describe('selective call subscriptions', () => {
  it('receives existing and late microphones and cameras without any screen media', () => {
    const { addRemote, publish, emit } = setup();
    const sender = addRemote('sender');
    const mic = fakePublication(Track.Source.Microphone, 'mic');
    const cam = fakePublication(Track.Source.Camera, 'cam');
    const screen = video('screen');
    const sound = audio('sound');
    sender.publications.set(mic.source, mic);
    sender.publications.set(screen.source, screen);
    emit(RoomEvent.SignalConnected);
    publish(sender, cam);
    publish(sender, sound);
    emit(RoomEvent.Connected);

    expect(mic.setSubscribed).toHaveBeenCalledExactlyOnceWith(true);
    expect(cam.setSubscribed).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.setSubscribed).not.toHaveBeenCalled();
    expect(sound.setSubscribed).not.toHaveBeenCalled();
  });

  it('watches streams independently and matches audio appearing before or after video', () => {
    const { addRemote, publish, unpublish, subscriptions } = setup();
    const anna = addRemote('anna');
    const bob = addRemote('bob');
    const annaVideo = video('a-video');
    const annaAudio = audio('a-audio');
    const bobVideo = video('b-video', secondCapture);
    const bobAudio = audio('b-audio', secondCapture);
    publish(anna, annaAudio);
    publish(anna, annaVideo);
    publish(bob, bobVideo);
    subscriptions.setWatching(anna.identity, screenShareId(annaVideo), true);
    subscriptions.setWatching(bob.identity, screenShareId(bobVideo), true);
    publish(bob, bobAudio);

    expect([annaVideo, annaAudio, bobVideo, bobAudio].map((pub) => pub.isDesired)).toEqual([true, true, true, true]);
    subscriptions.setWatching(anna.identity, screenShareId(annaVideo), false);
    expect([annaVideo, annaAudio, bobVideo, bobAudio].map((pub) => pub.isDesired)).toEqual([false, false, true, true]);

    unpublish(bob, bobVideo);
    expect(bobAudio.isDesired).toBe(false);
    const replacement = video('b-video-new');
    publish(bob, replacement);
    expect(replacement.isDesired).toBe(false);
    subscriptions.setWatching(bob.identity, screenShareId(replacement), true);
    expect(replacement.isDesired).toBe(true);
    expect(bobAudio.isDesired).toBe(false);
  });

  it('restores only selected captures and voice media after LiveKit reconnects', () => {
    const { addRemote, publish, unpublish, emit, subscriptions } = setup();
    const sender = addRemote('sender');
    const old = video('before');
    publish(sender, old);
    subscriptions.setWatching(sender.identity, screenShareId(old), true);
    unpublish(sender, old);

    const restored = video('after');
    const sound = audio('after-audio');
    const camera = fakePublication(Track.Source.Camera, 'after-camera');
    const mic = fakePublication(Track.Source.Microphone, 'after-mic');
    for (const pub of [restored, sound, camera, mic]) sender.publications.set(pub.source, pub);
    const untouched = addRemote('untouched');
    const untouchedScreen = video('other', secondCapture);
    untouched.publications.set(untouchedScreen.source, untouchedScreen);
    emit(RoomEvent.Reconnected);

    expect([restored, sound, camera, mic].every((pub) => pub.isDesired)).toBe(true);
    expect(untouchedScreen.isDesired).toBe(false);
    subscriptions.endCall();
    expect([restored, sound, camera, mic].map((pub) => pub.isDesired)).toEqual([false, false, true, true]);
    subscriptions.beginCall('voice-room');
    emit(RoomEvent.Connected);
    expect(restored.isDesired).toBe(false);
  });

  it('rejects a stale click and requires a new click for a legacy publication SID', () => {
    const { addRemote, publish, subscriptions } = setup();
    const sender = addRemote('sender');
    const old = fakePublication(Track.Source.ScreenShare, 'old');
    const sound = fakePublication(Track.Source.ScreenShareAudio, 'sound');
    publish(sender, old);
    publish(sender, sound);
    subscriptions.watchFromCall('other-call', sender.identity);
    expect(old.isDesired).toBe(false);
    subscriptions.watchFromCall('voice-room', sender.identity);
    expect(old.isDesired).toBe(true);
    expect(sound.isDesired).toBe(true);
    const replacement = fakePublication(Track.Source.ScreenShare, 'new');
    publish(sender, replacement);
    subscriptions.setWatching(sender.identity, screenShareId(old), true);
    expect(replacement.isDesired).toBe(false);
    expect(sound.isDesired).toBe(false);
  });

  it('withdraws the paired audio and permits retry if the video subscription fails', () => {
    const { addRemote, publish, emit, subscriptions } = setup();
    const sender = addRemote('sender');
    const screen = video('screen');
    const sound = audio('audio');
    publish(sender, screen);
    publish(sender, sound);
    subscriptions.setWatching(sender.identity, screenShareId(screen), true);
    emit(RoomEvent.TrackSubscriptionFailed, screen.trackSid, sender);
    expect(subscriptions.screenState(sender.identity, screenShareId(screen))).toBe('failed');
    expect(screen.isDesired).toBe(false);
    expect(sound.isDesired).toBe(false);
    subscriptions.setWatching(sender.identity, screenShareId(screen), true);
    expect(screen.isDesired).toBe(true);
    expect(sound.isDesired).toBe(true);
  });
});

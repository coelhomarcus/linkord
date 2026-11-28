import { RoomEvent, Track, TrackPublication } from 'livekit-client';
import type { RemoteParticipant, RemoteTrackPublication, Room } from 'livekit-client';
import { screenAudioMatches, screenShareId } from './screenSharePublication';

export type ScreenWatchState = 'available' | 'watching' | 'stopped' | 'failed';
type WatchChoice = { shareId: string; state: Exclude<ScreenWatchState, 'available'> };

/** Owns subscription intent for the current call, independently of mounted
 * tiles and of the publications LiveKit recreates during reconnect. */
export function createCallSubscriptions(room: Room) {
  let conversationId: string | null = null;
  const choices = new Map<string, WatchChoice>();
  const listeners = new Set<() => void>();

  function notify() {
    for (const listener of listeners) listener();
  }

  function screenState(participantId: string, shareId: string | null): ScreenWatchState {
    const choice = choices.get(participantId);
    return choice && choice.shareId === shareId ? choice.state : 'available';
  }

  function apply(pub: RemoteTrackPublication | undefined, desired: boolean) {
    if (pub && pub.isDesired !== desired) pub.setSubscribed(desired);
  }

  function reconcileScreen(participant: RemoteParticipant) {
    const video = participant.getTrackPublication(Track.Source.ScreenShare);
    const audio = participant.getTrackPublication(Track.Source.ScreenShareAudio);
    const shareId = screenShareId(video);
    const chosen = choices.get(participant.identity);
    if (shareId && chosen && chosen.shareId !== shareId) {
      choices.delete(participant.identity);
      notify();
    }
    const watching = !!conversationId && screenState(participant.identity, shareId) === 'watching';
    apply(video, watching);
    apply(audio, watching && screenAudioMatches(video, audio));
  }

  function reconcileParticipant(participant: RemoteParticipant) {
    if (!conversationId) return;
    apply(participant.getTrackPublication(Track.Source.Microphone), true);
    apply(participant.getTrackPublication(Track.Source.Camera), true);
    reconcileScreen(participant);
  }

  function reconcileRoom() {
    for (const participant of room.remoteParticipants.values()) reconcileParticipant(participant);
  }

  function endCall() {
    if (!conversationId) return;
    conversationId = null;
    const hadChoices = choices.size > 0;
    choices.clear();
    for (const participant of room.remoteParticipants.values()) reconcileScreen(participant);
    if (hadChoices) notify();
  }

  function beginCall(id: string) {
    if (conversationId === id) return;
    endCall();
    conversationId = id;
  }

  function setWatching(participantId: string, shareId: string | null, watching: boolean) {
    if (!conversationId || !shareId) return;
    const participant = room.remoteParticipants.get(participantId);
    const video = participant?.getTrackPublication(Track.Source.ScreenShare);
    if (!participant || shareId !== screenShareId(video)) return;
    const state = watching ? 'watching' : 'stopped';
    if (screenState(participantId, shareId) === state) return;
    choices.set(participantId, { shareId, state });
    reconcileScreen(participant);
    notify();
  }

  function watchFromCall(id: string, participantId: string) {
    if (id !== conversationId) return;
    const video = room.remoteParticipants.get(participantId)?.getTrackPublication(Track.Source.ScreenShare);
    setWatching(participantId, screenShareId(video), true);
  }

  function publicationChanged(_pub: RemoteTrackPublication, participant: RemoteParticipant) {
    reconcileParticipant(participant);
  }

  function subscriptionFailed(sid: string, participant: RemoteParticipant) {
    const video = participant.getTrackPublication(Track.Source.ScreenShare);
    const shareId = screenShareId(video);
    if (!shareId || video?.trackSid !== sid || screenState(participant.identity, shareId) !== 'watching') return;
    choices.set(participant.identity, { shareId, state: 'failed' });
    reconcileScreen(participant);
    notify();
  }

  function permissionChanged(pub: RemoteTrackPublication, status: TrackPublication.PermissionStatus, participant: RemoteParticipant) {
    if (status === TrackPublication.PermissionStatus.NotAllowed) subscriptionFailed(pub.trackSid, participant);
  }

  function listen() {
    room.on(RoomEvent.SignalConnected, reconcileRoom);
    room.on(RoomEvent.Connected, reconcileRoom);
    room.on(RoomEvent.Reconnected, reconcileRoom);
    room.on(RoomEvent.TrackPublished, publicationChanged);
    room.on(RoomEvent.TrackUnpublished, publicationChanged);
    room.on(RoomEvent.TrackSubscriptionFailed, subscriptionFailed);
    room.on(RoomEvent.TrackSubscriptionPermissionChanged, permissionChanged);
    return () => {
      room.off(RoomEvent.SignalConnected, reconcileRoom);
      room.off(RoomEvent.Connected, reconcileRoom);
      room.off(RoomEvent.Reconnected, reconcileRoom);
      room.off(RoomEvent.TrackPublished, publicationChanged);
      room.off(RoomEvent.TrackUnpublished, publicationChanged);
      room.off(RoomEvent.TrackSubscriptionFailed, subscriptionFailed);
      room.off(RoomEvent.TrackSubscriptionPermissionChanged, permissionChanged);
    };
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  return { listen, beginCall, endCall, setWatching, watchFromCall, screenState, subscribe };
}

export type CallSubscriptions = ReturnType<typeof createCallSubscriptions>;

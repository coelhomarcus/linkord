import { useEffect, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useRoom } from '../../state/RoomContext';
import { activeTrack, getParticipant, isTrackPending } from './useLiveKitTrack';
import { screenShareId } from './screenSharePublication';
import type { CallSubscriptions } from './callSubscriptions';
import { tileKey } from './tileTypes';
import type { TileDescriptor } from './tileTypes';

/** The server's call members, then anyone else LiveKit has in the room: the server removes such a
 * connection, but until it does the call still represents its LiveKit publications. */
function tileIds(room: Room, participantIds: string[]): string[] {
  const known = new Set(participantIds);
  const unknown = [...room.remoteParticipants.keys()].filter((id) => !known.has(id));
  return unknown.length > 0 ? [...participantIds, ...unknown] : participantIds;
}

function buildDescriptors(room: Room, subscriptions: CallSubscriptions, participantIds: string[]): TileDescriptor[] {
  const out: TileDescriptor[] = [];
  for (const id of tileIds(room, participantIds)) {
    const participant = getParticipant(room, id);
    if (!participant) continue;
    const screen = participant.getTrackPublication(Track.Source.ScreenShare);
    const hasCamera = !!activeTrack(participant, Track.Source.Camera);
    const cameraPending = !hasCamera && isTrackPending(participant, Track.Source.Camera);
    if (screen) {
      const watching = id === room.localParticipant.identity || subscriptions.screenState(id, screenShareId(screen)) === 'watching';
      out.push({ key: tileKey(id, 'screen'), participantId: id, kind: 'screen', loading: watching && !screen.isMuted && !screen.track, paused: screen.isMuted, watching });
    }
    const selfKind = hasCamera ? 'camera' : 'avatar';
    out.push({ key: tileKey(id, selfKind), participantId: id, kind: selfKind, loading: cameraPending, paused: false });
  }
  return out;
}

const CALL_TILE_EVENTS = [
  // the local tile otherwise waits for a track event, and someone who joined
  // alone without a mic never publishes one
  RoomEvent.Connected,
  RoomEvent.Reconnected,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
];

export function useCallTiles(participantIds: string[]): TileDescriptor[] {
  const { livekitRoom, callSubscriptions } = useRoom('livekitRoom', 'callSubscriptions');
  const [descriptors, setDescriptors] = useState<TileDescriptor[]>([]);
  const idsKey = participantIds.join(',');

  useEffect(() => {
    const refresh = () => setDescriptors(buildDescriptors(livekitRoom, callSubscriptions, idsKey ? idsKey.split(',') : []));
    refresh();
    for (const ev of CALL_TILE_EVENTS) livekitRoom.on(ev, refresh);
    const unsubscribe = callSubscriptions.subscribe(refresh);
    return () => {
      unsubscribe();
      for (const ev of CALL_TILE_EVENTS) livekitRoom.off(ev, refresh);
    };
  }, [livekitRoom, callSubscriptions, idsKey]);

  return descriptors;
}

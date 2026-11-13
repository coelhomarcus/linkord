import { useEffect, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useRoom } from '../../state/RoomContext';
import { activeTrack, getParticipant, isScreenPaused, isTrackPending } from './useLiveKitTrack';
import { tileKey } from './tileTypes';
import type { TileDescriptor } from './tileTypes';

/** The server's call members, then anyone else LiveKit has in the room: the server removes such a
 * connection, but until it does it hears and sees everything, so it is never left without a tile. */
function tileIds(room: Room, participantIds: string[]): string[] {
  const known = new Set(participantIds);
  const unknown = [...room.remoteParticipants.keys()].filter((id) => !known.has(id));
  return unknown.length > 0 ? [...participantIds, ...unknown] : participantIds;
}

function buildDescriptors(room: Room, participantIds: string[]): TileDescriptor[] {
  const out: TileDescriptor[] = [];
  for (const id of tileIds(room, participantIds)) {
    const participant = getParticipant(room, id);
    if (!participant) continue;
    const hasScreen = !!activeTrack(participant, Track.Source.ScreenShare);
    const hasCamera = !!activeTrack(participant, Track.Source.Camera);
    const screenPending = !hasScreen && isTrackPending(participant, Track.Source.ScreenShare);
    const cameraPending = !hasCamera && isTrackPending(participant, Track.Source.Camera);
    const screenPaused = !hasScreen && !screenPending && isScreenPaused(participant);
    if (hasScreen || screenPending || screenPaused) {
      out.push({ key: tileKey(id, 'screen'), participantId: id, kind: 'screen', loading: screenPending, paused: screenPaused });
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
  const { livekitRoom } = useRoom();
  const [descriptors, setDescriptors] = useState<TileDescriptor[]>([]);
  const idsKey = participantIds.join(',');

  useEffect(() => {
    const refresh = () => setDescriptors(buildDescriptors(livekitRoom, idsKey ? idsKey.split(',') : []));
    refresh();
    for (const ev of CALL_TILE_EVENTS) livekitRoom.on(ev, refresh);
    return () => { for (const ev of CALL_TILE_EVENTS) livekitRoom.off(ev, refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livekitRoom, idsKey]);

  return descriptors;
}

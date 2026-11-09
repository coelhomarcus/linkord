import { useEffect } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Participant, Room } from 'livekit-client';
import { hasPermission, PERMISSIONS } from '@/features/servers/permissionBits';
import { useRoom } from '@/state/RoomContext';

// What this account may send into the call it is in. The server puts it in
// the LiveKit grant (SPEAK: microphone, STREAM: camera and screen) and the
// SFU refuses anything else, so the buttons only follow it: the channel's
// bits draw them before LiveKit connects, LiveKit's own permission gates the
// publish itself.

type ParticipantPermission = NonNullable<Participant['permissions']>;

/** Whether the grant LiveKit holds for us allows `source`. Unknown (not
 * connected yet) counts as allowed: the token decides once it is. */
export function mayPublish(permissions: ParticipantPermission | undefined, source: Track.Source): boolean {
  if (!permissions) return true;
  if (!permissions.canPublish) return false;
  const sources = permissions.canPublishSources ?? [];
  // LiveKit reads an empty list as "every source"
  return sources.length === 0 || sources.some((s) => Track.sourceFromProto(s) === source);
}

export interface CallPublishRights {
  canSpeak: boolean;
  canStream: boolean;
}

/** From a call's conversation: a voice channel's resolved bits; a DM call
 * (no bits) allows everything. */
export function callPublishRights(conversation: { permissions?: number } | null | undefined): CallPublishRights {
  const bits = conversation?.permissions;
  if (bits === undefined) return { canSpeak: true, canStream: true };
  return { canSpeak: hasPermission(bits, PERMISSIONS.SPEAK), canStream: hasPermission(bits, PERMISSIONS.STREAM) };
}

export function useCallPublishRights(): CallPublishRights {
  const { conversations, activeCallConversationId } = useRoom();
  return callPublishRights(conversations.find((c) => c.id === activeCallConversationId));
}

/** When the server takes SPEAK or STREAM away mid-call, the SFU drops the
 * tracks; this stops them locally too, so the buttons and what others are
 * told (camera, sharing) stop claiming they are on. */
export function useEnforcePublishRights(room: Room, media: {
  leaveMic: () => Promise<void>;
  stopCamera: () => Promise<void> | void;
  stopSharing: () => Promise<void> | void;
}): void {
  const { leaveMic, stopCamera, stopSharing } = media;
  useEffect(() => {
    const onChange = (_previous: unknown, participant: Participant) => {
      if (participant !== room.localParticipant) return;
      const permissions = participant.permissions;
      if (!mayPublish(permissions, Track.Source.Microphone) && room.localParticipant.getTrackPublication(Track.Source.Microphone)) void leaveMic();
      if (!mayPublish(permissions, Track.Source.Camera) && room.localParticipant.getTrackPublication(Track.Source.Camera)) void stopCamera();
      if (!mayPublish(permissions, Track.Source.ScreenShare) && room.localParticipant.getTrackPublication(Track.Source.ScreenShare)) void stopSharing();
    };
    room.on(RoomEvent.ParticipantPermissionsChanged, onChange);
    return () => { room.off(RoomEvent.ParticipantPermissionsChanged, onChange); };
  }, [room, leaveMic, stopCamera, stopSharing]);
}

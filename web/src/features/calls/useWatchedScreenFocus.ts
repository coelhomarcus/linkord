import { useEffect } from 'react';
import { useRoom, useRoomSelector, useRoomState } from '@/state/RoomContext';
import type { RoomContextValue } from '@/state/RoomContext';
import { tileKey } from './tileTypes';
import type { TileDescriptor } from './tileTypes';

/** Whether the person someone asked to watch is still sharing in that call. Read from the server's
 * view, which knows about a share before this tab has its track. */
function stillSharing(room: RoomContextValue): boolean {
  const target = room.state.pendingScreenFocus;
  if (!target) return false;
  if (target.participantId === room.state.me.id) return room.state.me.sharing;
  const sharer = room.state.participants.get(target.participantId);
  return !!sharer && sharer.sharing && sharer.callConversationId === target.conversationId;
}

/** Puts the stage in focus on the share asked for from outside it (the "ao vivo" badge), as a
 * manual focus, once this call is the one asked for and that share's tile is there. Joining takes a
 * moment and the tile appears only once its publication arrives, so the request waits for it; a
 * share that ends first leaves the call as it opens, with nothing focused for it. */
export function useWatchedScreenFocus(descriptors: TileDescriptor[]): void {
  const { dispatch, activeCallConversationId } = useRoom('dispatch', 'activeCallConversationId');
  const { pendingScreenFocus: target } = useRoomState('pendingScreenFocus');
  const sharing = useRoomSelector(stillSharing);

  useEffect(() => {
    if (!target || target.conversationId !== activeCallConversationId) return;
    const key = tileKey(target.participantId, 'screen');
    if (descriptors.some((d) => d.key === key)) {
      dispatch({ type: 'SET_FOCUSED', id: key, origin: 'manual' });
      dispatch({ type: 'DROP_PENDING_SCREEN_FOCUS', target });
    } else if (!sharing) {
      dispatch({ type: 'DROP_PENDING_SCREEN_FOCUS', target });
    }
  }, [target, activeCallConversationId, descriptors, sharing, dispatch]);
}

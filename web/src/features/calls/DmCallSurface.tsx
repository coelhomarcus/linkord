import { useCallback } from 'react';
import { Avatar } from '@/shared/Avatar';
import { useRoom } from '@/state/RoomContext';
import { CallControlBar } from './CallControlBar';
import { dmCallHasMedia } from './dmCallMedia';
import { TileGrid } from './TileGrid';
import { useAutoFocusScreenShare } from './useAutoFocusScreenShare';
import { useCallTiles } from './useCallTiles';

export interface DmCallPeer {
  id: string;
  name: string;
  avatar: string;
  avatarPoster?: string;
  avatarColor: string;
}

/** The private call inside its DM: avatars until anyone publishes a camera or a screen. */
export function DmCallSurface({ participantIds, peers }: { participantIds: string[]; peers: DmCallPeer[] }) {
  const { state, dispatch } = useRoom();
  const descriptors = useCallTiles(participantIds);
  const media = dmCallHasMedia(descriptors);
  const focusScreenShare = useCallback((key: string) => dispatch({ type: 'SET_FOCUSED', id: key, origin: 'automatic' }), [dispatch]);
  useAutoFocusScreenShare(descriptors, state.focusOrigin, focusScreenShare);
  const handleCapacityChange = useCallback((meetsMinimum: boolean, suggestedKey: string | null) => {
    if (state.focusOrigin === 'manual') return;
    if (!meetsMinimum && !state.focusedId && suggestedKey) dispatch({ type: 'SET_FOCUSED', id: suggestedKey, origin: 'capacity' });
    else if (meetsMinimum && state.focusOrigin === 'capacity') dispatch({ type: 'SET_FOCUSED', id: null, origin: 'capacity' });
  }, [state.focusOrigin, state.focusedId, dispatch]);

  return (
    <div className={media ? 'relative flex min-h-[220px] flex-1 flex-col' : 'relative flex h-[280px] flex-none flex-col'}>
      {media ? (
        <div data-testid="dm-call-tiles" className="min-h-0 flex-1">
          <TileGrid descriptors={descriptors} focusedId={state.focusedId} onCapacityChange={handleCapacityChange} />
        </div>
      ) : (
        <div data-testid="dm-call-avatars" className="flex min-h-0 flex-1 items-center justify-center gap-6">
          {peers.map((peer) => (
            <Avatar key={peer.id} id={peer.id} name={peer.name} avatar={peer.avatar} poster={peer.avatarPoster} avatarColor={peer.avatarColor} size={96} />
          ))}
        </div>
      )}
      <CallControlBar hudVisible />
    </div>
  );
}

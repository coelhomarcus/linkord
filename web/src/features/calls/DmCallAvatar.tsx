import { CircleNotchIcon } from '@phosphor-icons/react';
import { useCallback } from 'react';
import type { MouseEvent } from 'react';

import { Avatar } from '@/shared/Avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { useIsSpeaking } from './useLiveKitTrack';
import { tileKey } from './tileTypes';

export interface DmCallPeer {
  id: string;
  name: string;
  avatar: string;
  avatarPoster?: string;
  avatarColor: string;
}

interface DmCallAvatarProps {
  peer: DmCallPeer;
  isMine: boolean;
  size: number;
  /** the camera is on but its video has not attached yet */
  loading?: boolean;
}

/** Someone in a DM call without video: a round avatar with a green ring
 * while they talk. */
export function DmCallAvatar({ peer, size, loading = false }: DmCallAvatarProps) {
  const { openTileMenu } = useRoom();
  const speaking = useIsSpeaking(peer.id);
  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openTileMenu(tileKey(peer.id, 'avatar'), peer.id, 'avatar', { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY });
  }, [openTileMenu, peer.id]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={<div />}
        data-dm-call-avatar={peer.id}
        data-speaking={speaking || undefined}
        aria-label={peer.name}
        onContextMenu={handleContextMenu}
        className="relative flex-none rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{ width: size, height: size }}
      >
        <Avatar
          id={peer.id}
          name={peer.name}
          avatar={peer.avatar}
          poster={peer.avatarPoster}
          frozen={!speaking}
          avatarColor={peer.avatarColor}
          size={size}
          className={cn(loading && 'opacity-50')}
        />
        {/* positioned outside the layout so talking never shifts the row */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute -inset-1 rounded-full border-[3px] transition-colors duration-100',
            speaking ? 'border-green' : 'border-transparent',
          )}
        />
        {loading && (
          <CircleNotchIcon aria-hidden size={Math.max(20, size / 3)} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-text-muted" />
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom">{peer.name}</TooltipContent>
    </Tooltip>
  );
}

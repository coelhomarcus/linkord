import { CircleNotchIcon, MicrophoneSlashIcon, SpeakerSlashIcon } from '@phosphor-icons/react';
import { useCallback } from 'react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { useIsSpeaking, useParticipantMedia } from './useLiveKitTrack';
import { tileKey } from './tileTypes';
import { TileMenuButton } from './TileMenuButton';

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
 * while they talk and a red badge while they are muted or deafened. */
export function DmCallAvatar({ peer, isMine, size, loading = false }: DmCallAvatarProps) {
  const { t } = useTranslation('calls');
  const { state, deafened, openTileMenu } = useRoom();
  const media = useParticipantMedia(peer.id);
  const speaking = useIsSpeaking(peer.id);
  const participant = isMine ? null : state.participants.get(peer.id);
  // Your own mic is read from LiveKit, like the dock; someone else's comes from
  // the server's mirror, which is already right before their LiveKit track lands.
  const isDeafened = isMine ? deafened : (participant?.deafened ?? false);
  const isMuted = isMine ? !media.micActivated || media.micMuted : !!participant && (!participant.micActivated || participant.micMuted);
  const status = isDeafened ? t('dm.status.deafened') : isMuted ? t('dm.status.muted') : null;
  const badgeSize = Math.max(14, Math.round(size * 0.3));

  const handleContextMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    openTileMenu(tileKey(peer.id, 'avatar'), peer.id, 'avatar', { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY });
  }, [openTileMenu, peer.id]);

  return (
    <div
      data-dm-call-avatar={peer.id}
      data-speaking={speaking || undefined}
      aria-label={status ? `${peer.name}, ${status}` : peer.name}
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
      <TileMenuButton
        name={peer.name}
        onOpen={(rect) => openTileMenu(tileKey(peer.id, 'avatar'), peer.id, 'avatar', rect)}
        className="left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      />
      {loading && (
        <CircleNotchIcon aria-hidden size={Math.max(20, size / 3)} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-text-muted" />
      )}
      {status && (
        <span
          role="img"
          aria-label={status}
          data-dm-call-status={isDeafened ? 'deafened' : 'muted'}
          className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-red text-white ring-4 ring-bg-call"
          style={{ width: badgeSize, height: badgeSize }}
        >
          {isDeafened
            ? <SpeakerSlashIcon size={Math.round(badgeSize * 0.6)} weight="fill" />
            : <MicrophoneSlashIcon size={Math.round(badgeSize * 0.6)} weight="fill" />}
        </span>
      )}
    </div>
  );
}

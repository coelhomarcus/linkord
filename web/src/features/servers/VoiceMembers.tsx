import {
  ArrowsLeftRightIcon, ChatCircleIcon, MicrophoneSlashIcon, PhoneSlashIcon, SpeakerHighIcon, SpeakerSimpleSlashIcon,
  SpeakerSlashIcon, UserIcon, VideoCameraIcon,
} from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import type { DragEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar, colorFor } from '@/shared/Avatar';
import { iconWeight } from '@/shared/ui/icons';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from '@/shared/ui/primitives/dropdown-menu';
import { Slider } from '@/shared/ui/primitives/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { ChannelSummary, ServerSummary } from '@/shared/types/protocol';
import { useIsSpeaking, useParticipantMedia } from '@/features/calls/useLiveKitTrack';
import { useMuteForMe } from '@/features/calls/useMuteForMe';
import { useStreamPreview } from '@/features/calls/streamPreviewStore';
import { canMoveInto, canMoveOutOf } from './serverUtils';

/** Who is being dragged out of which voice channel, while the drag lasts. */
export interface VoiceDrag {
  participantId: string;
  fromChannelId: string;
}

interface VoicePerson {
  /** the connection (LiveKit identity), not the account */
  id: string;
  userId: string;
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  isMe: boolean;
  speaking: boolean;
  micMuted: boolean;
  deafened: boolean;
  cameraOn: boolean;
  sharing: boolean;
}

/** The account's own row. `state.participants` leaves it out, so its media
 * comes from the local LiveKit room, the same way the call's own tile and
 * the dock read it: speaking lights up for you too, not just for the others. */
function useMyVoicePerson(): VoicePerson {
  const { state, deafened } = useRoom();
  const media = useParticipantMedia(state.me.id ?? '');
  const speaking = useIsSpeaking(state.me.id ?? '');
  return {
    id: state.me.id ?? 'me', userId: state.me.userId ?? 'me', displayName: state.me.displayName,
    avatar: state.me.avatar, avatarPoster: state.me.avatarPoster, avatarColor: state.me.avatarColor, isMe: true,
    speaking, micMuted: !media.micActivated || media.micMuted, deafened, cameraOn: state.me.cameraOn, sharing: state.me.sharing,
  };
}

/** The still of a share, asked for when the tooltip opens. The box is 16:9
 * from the first frame, so the tooltip never jumps when the picture lands;
 * an older still stays up while the fresh one is on its way. */
function StreamPreviewImage({ participantId, name }: { participantId: string; name: string }) {
  const { t } = useTranslation('servers');
  const { sendWs } = useRoom();
  const preview = useStreamPreview(participantId);
  const [openedAt] = useState(() => Date.now());
  useEffect(() => { sendWs({ t: 'stream-preview-request', participantId }); }, [participantId, sendWs]);
  const answered = !!preview && preview.receivedAt >= openedAt;

  return (
    <div className="relative grid aspect-video w-64 place-items-center overflow-hidden rounded-md bg-black text-caption text-white/70">
      {preview?.image
        ? <img src={preview.image} alt={t('voiceMembers.previewOf', { name })} className="absolute inset-0 h-full w-full object-contain" />
        : answered
          ? <span>{t('voiceMembers.previewUnavailable')}</span>
          : <span role="status" aria-label={t('voiceMembers.previewLoading')} className="absolute inset-0 animate-pulse bg-white/5" />}
    </div>
  );
}

function LiveBadge({ person, previewable }: { person: VoicePerson; previewable: boolean }) {
  const { t } = useTranslation('servers');
  const badge = <span className="rounded-sm bg-red px-1 text-[10px] font-bold uppercase leading-4 text-white">{t('voiceMembers.status.live')}</span>;
  if (!previewable) return <span role="img" aria-label={t('voiceMembers.status.live')} className="flex">{badge}</span>;
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />} aria-label={t('voiceMembers.status.live')} className="flex rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {badge}
      </TooltipTrigger>
      <TooltipContent side="right" className="flex-col items-stretch p-1.5">
        <StreamPreviewImage participantId={person.id} name={person.displayName} />
      </TooltipContent>
    </Tooltip>
  );
}

/** The icons the call dock uses, so the list reads the same: muted, not
 * listening, camera on, then the "ao vivo" badge of a share. */
function VoiceStatus({ person, previewable }: { person: VoicePerson; previewable: boolean }) {
  const { t } = useTranslation('servers');
  const icon = 'flex-none';
  return (
    <span className="flex flex-none items-center gap-1">
      {person.micMuted && <MicrophoneSlashIcon size={16} weight={iconWeight(true)} role="img" aria-label={t('voiceMembers.status.muted')} className={cn(icon, 'text-red-text')} />}
      {person.deafened && <SpeakerSlashIcon size={16} weight={iconWeight(true)} role="img" aria-label={t('voiceMembers.status.deafened')} className={cn(icon, 'text-red-text')} />}
      {person.cameraOn && <VideoCameraIcon size={16} weight={iconWeight(true)} role="img" aria-label={t('voiceMembers.status.camera')} className={cn(icon, 'text-text-muted')} />}
      {person.sharing && <LiveBadge person={person} previewable={previewable} />}
    </span>
  );
}

function rectAt(x: number, y: number) {
  return { getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) };
}

interface MenuTarget { person: VoicePerson; x: number; y: number }

/** What a right click on someone in a voice channel offers: their profile
 * and a message, your own volume for them when you share the call, and for
 * whoever may move members, another channel or out of this one. */
function VoiceMemberMenu({ target, server, channel, onClose, onOpenProfile }: {
  target: MenuTarget; server: ServerSummary; channel: ChannelSummary; onClose: () => void; onOpenProfile: (userId: string) => void;
}) {
  const { t } = useTranslation('servers');
  const { state, activeCallConversationId, friendUserIds, openDirect, requestChatView, kickFromCall, moveToCall } = useRoom();
  const { person } = target;
  const sharesMyCall = !person.isMe && activeCallConversationId === channel.id;
  const { hasAudio, volume, muted, setVolume, toggleMute } = useMuteForMe(sharesMyCall ? person.id : null, 'camera', false);
  const meIsAdmin = state.me.role === 'admin';
  const canModerate = !person.isMe && canMoveOutOf(channel, meIsAdmin);
  const destinations = canModerate ? server.channels.filter((c) => c.type === 'voice' && c.id !== channel.id && canMoveInto(c, meIsAdmin)) : [];

  return (
    <DropdownMenu open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DropdownMenuContent anchor={rectAt(target.x, target.y)} side="bottom" align="start" sideOffset={4} className="w-60">
        <DropdownMenuItem onClick={() => onOpenProfile(person.userId)}>
          <UserIcon size={16} /><span>{t('voiceMembers.menu.profile')}</span>
        </DropdownMenuItem>
        {!person.isMe && friendUserIds.has(person.userId) && (
          <DropdownMenuItem onClick={() => { openDirect(person.userId); requestChatView(); }}>
            <ChatCircleIcon size={16} /><span>{t('voiceMembers.menu.message')}</span>
          </DropdownMenuItem>
        )}
        {sharesMyCall && hasAudio && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem closeOnClick={false} onClick={toggleMute}>
              {muted ? <SpeakerHighIcon size={16} /> : <SpeakerSimpleSlashIcon size={16} />}
              <span>{muted ? t('voiceMembers.menu.unmuteForMe') : t('voiceMembers.menu.muteForMe')}</span>
            </DropdownMenuItem>
            <div className="px-2.5 py-2">
              <Slider value={[volume]} onValueChange={(value) => setVolume(Array.isArray(value) ? (value[0] ?? 0) : (value as number))} min={0} max={100}
                aria-label={t('voiceMembers.menu.volume', { name: person.displayName })} />
            </div>
          </>
        )}
        {canModerate && (
          <>
            <DropdownMenuSeparator />
            {/* the destinations sit in the menu itself, not a submenu: reachable
                by keyboard in one list, for whoever cannot drag */}
            {destinations.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel className="flex items-center gap-1.5"><ArrowsLeftRightIcon size={14} aria-hidden />{t('voiceMembers.menu.moveTo')}</DropdownMenuLabel>
                {destinations.map((destination) => (
                  <DropdownMenuItem key={destination.id} onClick={() => moveToCall(person.id, destination.id)}>
                    <SpeakerHighIcon size={16} /><span className="truncate">{destination.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            )}
            <DropdownMenuItem variant="destructive" onClick={() => kickFromCall(person.id)}>
              <PhoneSlashIcon size={16} /><span>{t('voiceMembers.menu.disconnect')}</span>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Who is in a voice channel, under its row in the channel list, as everyone
 * in the server sees it, in the call or not: who is talking, who is muted or
 * not listening, cameras and shares. A name opens the profile; a right click
 * opens the member menu; whoever may move members drags people between
 * channels. */
export function VoiceMembers({ server, channel, onOpenProfile, drag, onDragChange }: {
  server: ServerSummary; channel: ChannelSummary; onOpenProfile: (userId: string) => void;
  drag: VoiceDrag | null; onDragChange: (drag: VoiceDrag | null) => void;
}) {
  const { t } = useTranslation('servers');
  const { state, activeCallConversationId } = useRoom();
  const me = useMyVoicePerson();
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const inThisCall = activeCallConversationId === channel.id;
  const others: VoicePerson[] = [...state.participants.values()]
    .filter((p) => p.callConversationId === channel.id)
    .map((p) => ({
      id: p.id, userId: p.userId, displayName: p.displayName, avatar: p.avatar, avatarPoster: p.avatarPoster, avatarColor: p.avatarColor,
      isMe: false, speaking: p.speaking, micMuted: !p.micActivated || p.micMuted, deafened: p.deafened, cameraOn: p.cameraOn, sharing: p.sharing,
    }));
  const people = inThisCall ? [me, ...others] : others;
  const canDrag = canMoveOutOf(channel, state.me.role === 'admin');
  if (!people.length) return null;

  function openMenu(person: VoicePerson, event: MouseEvent) {
    event.preventDefault();
    setMenu({ person, x: event.clientX, y: event.clientY });
  }

  function startDrag(person: VoicePerson, event: DragEvent) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', person.displayName);
    onDragChange({ participantId: person.id, fromChannelId: channel.id });
  }

  return (
    <>
      <ul aria-label={t('voiceMembers.inChannel', { channel: channel.name })} className="mb-1 ml-8 mr-2 flex flex-col">
        {people.map((person) => {
          const draggable = canDrag && !person.isMe;
          return (
            <li
              key={person.id}
              data-voice-member={person.id}
              draggable={draggable || undefined}
              onDragStart={draggable ? (event) => startDrag(person, event) : undefined}
              onDragEnd={draggable ? () => onDragChange(null) : undefined}
              onContextMenu={(event) => openMenu(person, event)}
              className={cn(
                'group/member flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-nav-hover',
                draggable && 'cursor-grab active:cursor-grabbing',
                drag?.participantId === person.id && 'opacity-50',
              )}
            >
              <button type="button" onClick={() => onOpenProfile(person.userId)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-label text-text-secondary group-hover/member:text-text-primary">
                {/* the name beside it already says who: the avatar's initials would only repeat it */}
                <span aria-hidden data-speaking={person.speaking || undefined}
                  className={cn('inline-flex flex-none rounded-full ring-2 transition-shadow', person.speaking ? 'ring-current' : 'ring-transparent')}
                  style={person.speaking ? { color: colorFor(person.userId, person.avatarColor) } : undefined}>
                  <Avatar id={person.userId} name={person.displayName} avatar={person.avatar} poster={person.avatarPoster} avatarColor={person.avatarColor} size={24} />
                </span>
                <span className="truncate">{person.displayName}</span>
              </button>
              <VoiceStatus person={person} previewable={!person.isMe} />
            </li>
          );
        })}
      </ul>
      {menu && <VoiceMemberMenu target={menu} server={server} channel={channel} onClose={() => setMenu(null)} onOpenProfile={onOpenProfile} />}
    </>
  );
}

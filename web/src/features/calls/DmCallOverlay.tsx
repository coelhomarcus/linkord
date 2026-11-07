import { useEffect } from 'react';
import { PhoneIcon, PhoneSlashIcon, VideoCameraIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { playSound } from '@/shared/sounds';
import { useRoom } from '@/state/RoomContext';
import type { DmCallEndReason } from '@/shared/types/protocol';

const ENDED_KEY: Record<DmCallEndReason, 'dm.declined' | 'dm.cancelled' | 'dm.missed' | 'dm.ended' | 'dm.failed'> = {
  declined: 'dm.declined',
  cancelled: 'dm.cancelled',
  missed: 'dm.missed',
  ended: 'dm.ended',
  failed: 'dm.failed',
};

export function DmCallOverlay() {
  const { t } = useTranslation('calls');
  const { dmCall, acceptDmCall, declineDmCall, cancelDmCall, allUsers } = useRoom();
  const ringId = dmCall && (dmCall.phase === 'incoming' || dmCall.phase === 'outgoing') ? `${dmCall.callId}:${dmCall.phase}` : null;

  useEffect(() => {
    if (!ringId) return;
    playSound('newMessage');
    const timer = window.setInterval(() => playSound('newMessage'), 2500);
    return () => window.clearInterval(timer);
  }, [ringId]);

  if (!dmCall) return null;
  const peer = allUsers.get(dmCall.peerId);
  const name = peer?.displayName || t('dm.someone');
  const title = dmCall.phase === 'ended'
    ? t(ENDED_KEY[dmCall.reason ?? 'ended'])
    : dmCall.phase === 'outgoing'
      ? t('dm.calling')
      : dmCall.video ? t('dm.incomingVideo') : t('dm.incomingVoice');

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
      <div
        role="dialog"
        aria-label={title}
        className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border border-border-subtle bg-bg-floating p-3 shadow-popover"
      >
        <Avatar
          id={dmCall.peerId}
          name={name}
          avatar={peer?.avatar ?? ''}
          poster={peer?.avatarPoster}
          avatarColor={peer?.avatarColor ?? ''}
          size={48}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-label font-semibold text-text-primary">{name}</p>
          <p className="flex items-center gap-1 truncate text-caption text-text-secondary">
            {dmCall.video ? <VideoCameraIcon size={14} aria-hidden /> : <PhoneIcon size={14} aria-hidden />}
            {title}
          </p>
        </div>
        {dmCall.phase === 'incoming' && (
          <div className="flex flex-none items-center gap-2">
            <button type="button" onClick={declineDmCall} aria-label={t('dm.decline')} className="grid size-10 place-items-center rounded-full bg-red text-white hover:bg-red-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <PhoneSlashIcon size={18} weight="fill" aria-hidden />
            </button>
            <button type="button" onClick={acceptDmCall} aria-label={t('dm.accept')} className="grid size-10 place-items-center rounded-full bg-green-solid text-white hover:bg-green-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              {dmCall.video ? <VideoCameraIcon size={18} weight="fill" aria-hidden /> : <PhoneIcon size={18} weight="fill" aria-hidden />}
            </button>
          </div>
        )}
        {dmCall.phase === 'outgoing' && (
          <button type="button" onClick={cancelDmCall} aria-label={t('dm.cancel')} className="grid size-10 flex-none place-items-center rounded-full bg-red text-white hover:bg-red-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <PhoneSlashIcon size={18} weight="fill" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

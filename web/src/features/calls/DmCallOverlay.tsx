import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PhoneIcon, PhoneSlashIcon, PhoneXIcon, VideoCameraIcon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/shared/Avatar';
import { startRingtone } from '@/shared/sounds';
import { Button } from '@/shared/ui/primitives/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/shared/ui/primitives/dialog';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';

export function DmCallOverlay() {
  const { t } = useTranslation('calls');
  const { dmCall, acceptDmCall, declineDmCall, cancelDmCall, dismissDmCallNotice, allUsers } = useRoom();
  const popupRef = useRef<HTMLDivElement>(null);
  const ringPhase = dmCall?.phase === 'incoming' || dmCall?.phase === 'outgoing' ? dmCall.phase : null;
  const ringCallId = ringPhase ? dmCall?.callId : null;

  useEffect(() => {
    if (!ringPhase) return;
    return startRingtone(ringPhase);
  }, [ringCallId, ringPhase]);

  // The dialog keeps showing the last call while its exit plays.
  const [shown, setShown] = useState(dmCall);
  if (dmCall && dmCall !== shown) setShown(dmCall);

  const failed = shown?.phase === 'ended';
  const peer = shown ? allUsers.get(shown.peerId) : undefined;
  const name = peer?.displayName || t('dm.someone');
  const status = shown?.phase === 'outgoing'
    ? t('dm.calling')
    : shown?.video ? t('dm.incomingVideo') : t('dm.incomingVoice');

  return (
    <Dialog
      open={!!dmCall}
      // A ringing call is answered with its buttons only: Escape or a stray
      // click outside must not decline it. A failure closes like any notice.
      onOpenChange={(open) => { if (!open && dmCall?.phase === 'ended') dismissDmCallNotice(); }}
      disablePointerDismissal={!failed}
    >
      <DialogContent
        showCloseButton={false}
        // Focus lands on the dialog, not on a button: the call can arrive
        // mid-sentence and Enter must not answer it, while a screen reader
        // still announces who is calling.
        ref={popupRef}
        initialFocus={popupRef}
        className="flex flex-col items-center gap-0 px-6 pt-8 pb-6 text-center sm:max-w-80"
      >
        {shown && failed ? (
          <>
            <span className="grid size-16 place-items-center rounded-full bg-red/15 text-red" aria-hidden>
              <PhoneXIcon size={28} weight="fill" />
            </span>
            <DialogTitle className="mt-4 text-title">{t('dm.failed')}</DialogTitle>
            <Button type="button" variant="outline" className="mt-6 w-full" onClick={dismissDmCallNotice}>
              {t('dm.close')}
            </Button>
          </>
        ) : shown && (
          <>
            <Avatar
              id={shown.peerId}
              name={name}
              avatar={peer?.avatar ?? ''}
              poster={peer?.avatarPoster}
              avatarColor={peer?.avatarColor ?? ''}
              size={88}
            />
            <DialogTitle className="mt-4 w-full truncate text-title">{name}</DialogTitle>
            <DialogDescription className="mt-1 flex items-center gap-1.5">
              {shown.video ? <VideoCameraIcon size={16} aria-hidden /> : <PhoneIcon size={16} aria-hidden />}
              {status}
            </DialogDescription>
            <div className="mt-8 flex justify-center gap-12">
              {shown.phase === 'incoming' && (
                <>
                  <CallAnswerButton label={t('dm.decline')} tone="decline" onClick={declineDmCall}>
                    <PhoneSlashIcon size={24} weight="fill" />
                  </CallAnswerButton>
                  <CallAnswerButton label={t('dm.accept')} tone="accept" onClick={acceptDmCall}>
                    {shown.video ? <VideoCameraIcon size={24} weight="fill" /> : <PhoneIcon size={24} weight="fill" />}
                  </CallAnswerButton>
                </>
              )}
              {shown.phase === 'outgoing' && (
                <CallAnswerButton label={t('dm.cancel')} tone="decline" onClick={cancelDmCall}>
                  <PhoneSlashIcon size={24} weight="fill" />
                </CallAnswerButton>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CallAnswerButton({ label, tone, onClick, children }: {
  label: string;
  tone: 'accept' | 'decline';
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} className="group flex flex-col items-center gap-2 outline-none">
      <span
        aria-hidden
        className={cn(
          'grid size-14 place-items-center rounded-full text-white transition-colors duration-100 group-focus-visible:ring-3 group-focus-visible:ring-ring/50',
          tone === 'accept' ? 'bg-green-solid group-hover:bg-green-hover' : 'bg-red group-hover:bg-red-hover',
        )}
      >
        {children}
      </span>
      <span className="text-caption text-text-secondary group-hover:text-text-primary">{label}</span>
    </button>
  );
}

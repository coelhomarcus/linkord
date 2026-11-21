import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PushPinIcon, XIcon } from '@/shared/ui/icons';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Button } from '@/shared/ui/primitives/button';
import { EmptyIllustration } from '@/shared/ui/empty-illustrations';
import { cn } from '@/shared/lib/utils';
import { useRoom, useRoomState } from '@/state/RoomContext';
import type { Conversation, PinnedItem } from '@/shared/types/protocol';
import { messagePermissions } from '@/features/chat/messageActions';
import { MessageCard } from './MessageCard';
import { EMPTY_PINS } from './usePins';
import { closePinsPanel, openPinsPanel, usePinsPanelOpen } from './pinsPanel';
import { useMessagePinConfirm } from './useMessagePinConfirm';

/** The header's pin: Discord's push pin, a dot while there is a pin this
 * account has not opened yet, and the conversation's pins under it. */
export function PinsButton({ conversation, className, onOpenProfile }: { conversation: Conversation; className: string; onOpenProfile: (userId: string) => void }) {
  const { t } = useTranslation('pins');
  const { unseenPins, ackPins } = useRoom('unseenPins', 'ackPins');
  const open = usePinsPanelOpen(conversation.id);
  const unseen = unseenPins.has(conversation.id);
  const label = unseen ? t('buttonUnseen') : t('button');
  const [unpinFailed, setUnpinFailed] = useState(false);
  // out here, not in the list: the dialog outlives the popover closing under it
  const { requestPin, pinConfirmDialog } = useMessagePinConfirm({ onDone: (ok) => setUnpinFailed(!ok) });

  // opening it is reading it, and a pin arriving while it is open is read too
  useEffect(() => {
    if (open && unseen) ackPins(conversation.id);
  }, [open, unseen, ackPins, conversation.id]);
  // another conversation's header takes over: this one's panel is no longer what is open
  useEffect(() => () => closePinsPanel(), [conversation.id]);

  return (
    <Popover open={open} onOpenChange={(next) => (next ? openPinsPanel(conversation.id) : closePinsPanel())}>
      <Tooltip disabled={open}>
        <TooltipTrigger render={<PopoverTrigger aria-label={label} aria-pressed={open} className={cn(className, 'relative')} />}>
          <PushPinIcon size={24} weight="fill" />
          {unseen && <span aria-hidden data-testid="pins-unseen-dot" className="absolute bottom-1 right-0.5 size-2.5 rounded-full border-2 border-bg-primary bg-primary" />}
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent side="bottom" align="end" sideOffset={8} className="flex max-h-[min(36rem,calc(100dvh-6rem))] w-[min(26.5rem,calc(100vw-1.5rem))] flex-col gap-0 overflow-hidden rounded-[12px] border-border-default bg-bg-modal p-0">
        <div className="flex flex-none items-center gap-2 border-b border-border-default px-4 py-3.5">
          <PushPinIcon size={22} weight="fill" className="flex-none text-text-secondary" aria-hidden />
          <h2 className="flex-1 select-none text-heading font-bold text-text-strong">{t('title')}</h2>
        </div>
        <PinsList conversation={conversation} onOpenProfile={onOpenProfile} unpinFailed={unpinFailed} onUnpin={(msgId, skipConfirm) => { setUnpinFailed(false); requestPin(msgId, false, skipConfirm); }} />
      </PopoverContent>
      {pinConfirmDialog}
    </Popover>
  );
}

function PinsList({ conversation, onOpenProfile, unpinFailed, onUnpin }: {
  conversation: Conversation;
  onOpenProfile: (userId: string) => void;
  unpinFailed: boolean;
  onUnpin: (msgId: number, skipConfirm: boolean) => void;
}) {
  const { t } = useTranslation('pins');
  const { pinsByConversation, loadPins, jumpToMessage } = useRoom('pinsByConversation', 'loadPins', 'jumpToMessage');
  const { me } = useRoomState('me');
  const list = pinsByConversation.get(conversation.id) ?? EMPTY_PINS;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // read on open, and again whenever a pin or unpin dropped the list
  useEffect(() => {
    if (!list.loaded && !list.loading) loadPins(conversation.id);
  }, [list.loaded, list.loading, loadPins, conversation.id]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !list.hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadPins(conversation.id, true);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [list.hasMore, loadPins, conversation.id]);

  function jump(item: PinnedItem) {
    closePinsPanel();
    jumpToMessage(item.message.conversationId, item.message.msgId);
  }

  if (!list.loaded) {
    return <p role="status" className="select-none px-4 py-10 text-center text-label text-text-muted">{t('loading')}</p>;
  }

  if (!list.items.length) {
    const direct = conversation.type === 'direct';
    return (
      <div className="flex flex-col">
        <div className="flex select-none flex-col items-center gap-3 px-6 py-8 text-center">
          <EmptyIllustration name="pin" className="h-[96px] w-32 flex-none" />
          <p className="max-w-64 text-body font-medium text-text-primary">{direct ? t('empty.direct') : t('empty.channel')}</p>
        </div>
        <div className="select-none bg-bg-tertiary/60 px-6 py-4 text-center">
          <p className="text-label font-semibold text-green">{t('empty.tipTitle')}</p>
          <p className="mt-1 text-label text-text-secondary">{direct ? t('empty.tipDirect') : t('empty.tipChannel')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
      {unpinFailed && <p role="alert" className="px-1 text-label text-red-text">{t('unpinFailed')}</p>}
      {list.items.map((item) => {
        const canUnpin = messagePermissions(item.message, { userId: me.userId, role: me.role }, conversation).pin;
        return (
          <MessageCard
            key={item.message.msgId}
            message={item.message}
            onOpenProfile={onOpenProfile}
            actions={(
              <>
                <Button type="button" variant="secondary" size="sm" onClick={() => jump(item)}>{t('jump')}</Button>
                {canUnpin && (
                  <Tooltip>
                    <TooltipTrigger
                      render={<Button type="button" variant="secondary" size="icon-sm" />}
                      aria-label={t('unpin')}
                      onClick={(event) => onUnpin(item.message.msgId, event.shiftKey)}
                    >
                      <XIcon size={16} />
                    </TooltipTrigger>
                    <TooltipContent side="top">{t('unpin')}</TooltipContent>
                  </Tooltip>
                )}
              </>
            )}
          />
        );
      })}
      {list.hasMore ? <div ref={sentinelRef} className="h-px flex-none" /> : <p className="select-none py-2 text-center text-caption text-text-muted">{t('end')}</p>}
    </div>
  );
}

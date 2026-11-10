import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretRightIcon, IdentificationBadgeIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { CopyLabel, CopyStatusIcon } from '@/shared/CopyFeedback';
import { useCopyToClipboard } from '@/shared/hooks/useCopyToClipboard';
import { useRoom } from '@/state/RoomContext';
import type { PresenceStatus } from '@/shared/types/protocol';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { StatusDot } from './StatusDot';
import { STATUS_CHOICES, liveCustomStatus } from './statusDisplay';
import { useCustomStatusActions } from './useCustomStatusActions';

const GROUP = 'flex flex-col overflow-hidden rounded-lg border border-border-strong bg-bg-tertiary divide-y divide-border-strong';
const ROW = cn(
  'flex min-h-10 w-full items-center gap-2.5 px-3 py-2 text-left text-label font-medium text-text-primary transition-colors',
  'hover:bg-fill-hover focus-visible:bg-fill-hover focus-visible:outline-none data-popup-open:bg-fill-hover',
  'disabled:cursor-default disabled:hover:bg-transparent [&>svg]:flex-none [&>svg]:text-text-secondary',
);

/** The user panel's card: who you are (banner, avatar, name, links), your custom status as the
 * bubble beside the avatar, and below it your status (a submenu with the four), editing your
 * profile and copying your ID. `trigger` is the panel's avatar-and-name button. */
export function StatusMenu({ trigger, onOpenProfile, side = 'top', onError }: {
  trigger: ReactElement;
  onOpenProfile: () => void;
  side?: 'top' | 'right';
  /** a refused or unanswered change, already worded for the user */
  onError: (message: string) => void;
}) {
  const { t } = useTranslation('status');
  const { state, ownStatus, setPresence, reconnecting } = useRoom();
  const [open, setOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  const { copied, copy } = useCopyToClipboard();
  const popupRef = useRef<HTMLDivElement | null>(null);
  const customActions = useCustomStatusActions(onError);
  const custom = liveCustomStatus(ownStatus.customStatus);
  const me = state.me;
  const userId = me.userId ?? me.id ?? '';
  const shown = reconnecting ? 'reconnecting' : ownStatus.effective;
  const statusLabel = reconnecting ? t('menu.reconnecting') : t(`statuses.${ownStatus.effective}`);

  function change(patch: Parameters<typeof setPresence>[0]) {
    setPresence(patch).catch((err: unknown) => onError(err instanceof Error ? err.message : t('errors.saveFailed')));
  }

  /** Clearing removes the buttons that were just used; without this, focus would fall back to the
   * panel behind the still-open card. The invitation that takes the bubble's place gets it instead. */
  function clearCustom() {
    customActions.clear();
    window.setTimeout(() => popupRef.current?.querySelector<HTMLElement>('[data-custom-status-bubble] button')?.focus());
  }

  /** Up and down move between everything you can act on in the card, wrapping around. Capture phase,
   * so the status row's menu button does not take the arrow as "open". The submenu is in a portal,
   * outside this element, and keeps its own keys. */
  function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
    if (items.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (at + 1) % items.length
          : (at <= 0 ? items.length : at) - 1;
    items[next]?.focus();
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={trigger} />
        <PopoverContent
          side={side}
          // beside the narrow rail the panel sits at the bottom, so the card grows upwards from it
          align={side === 'right' ? 'end' : 'start'}
          sideOffset={8}
          ref={popupRef}
          aria-label={t('menu.trigger')}
          onKeyDownCapture={moveFocus}
          className="scrollbar-none max-h-(--available-height) w-80 max-w-[calc(100vw-1rem)] gap-0 overflow-y-auto bg-bg-modal p-0"
        >
          <ProfileCard
            bare
            user={{
              id: userId || 'me',
              displayName: me.displayName,
              username: me.name,
              avatar: me.avatar,
              avatarColor: me.avatarColor,
              banner: me.banner,
              // the quick card leaves the bio to the full profile, one click away
              bio: '',
              profileLinks: me.profileLinks,
              role: me.role,
            }}
            status={shown}
            customStatus={custom}
            onEditCustomStatus={() => { setOpen(false); customActions.openEditor(); }}
            onClearCustomStatus={clearCustom}
            footer={(
              <div className="mt-4 flex flex-col gap-2">
                <div className={GROUP}>
                  <button type="button" className={ROW} onClick={() => { setOpen(false); onOpenProfile(); }}>
                    <PencilSimpleIcon size={18} />
                    {t('menu.editProfile')}
                  </button>
                  <DropdownMenu open={statusMenuOpen} onOpenChange={setStatusMenuOpen} modal={false}>
                    <DropdownMenuTrigger
                      disabled={reconnecting}
                      aria-label={t('menu.currentStatus', { status: statusLabel })}
                      onKeyDown={(e) => { if (e.key === 'ArrowRight') { e.preventDefault(); setStatusMenuOpen(true); } }}
                      render={<button type="button" className={ROW} />}
                    >
                      <StatusDot status={shown} className="ml-1 size-3 flex-none text-bg-tertiary" />
                      <span className="min-w-0 flex-1 truncate">{statusLabel}</span>
                      <CaretRightIcon size={16} />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent side="right" align="start" sideOffset={12} alignOffset={-6} className="w-72 p-1.5">
                      <DropdownMenuRadioGroup value={ownStatus.status} onValueChange={(value) => { if (value !== ownStatus.status) change({ status: value as PresenceStatus }); }}>
                        {STATUS_CHOICES.map((status) => (
                          <DropdownMenuRadioItem key={status} value={status} closeOnClick className="items-start whitespace-normal py-2">
                            <StatusDot status={status} className="mt-1 size-3 flex-none text-popover" />
                            <span className="min-w-0 flex-1">
                              <span className="block">{t(`statuses.${status}`)}</span>
                              <span className="block text-caption font-normal text-text-muted">{t(`descriptions.${status}`)}</span>
                            </span>
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className={GROUP}>
                  <button type="button" className={ROW} onClick={() => void copy(userId)} disabled={!userId}>
                    <CopyStatusIcon copied={copied} size={18} icon={IdentificationBadgeIcon} checkClassName="text-green!" />
                    <span className="min-w-0 flex-1 truncate">{t('menu.copyId')}</span>
                    <span className="flex-none text-caption font-normal text-green"><CopyLabel copied={copied} /></span>
                  </button>
                </div>
              </div>
            )}
          />
        </PopoverContent>
      </Popover>
      {customActions.dialog}
    </>
  );
}

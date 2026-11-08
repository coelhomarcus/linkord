import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { PencilSimpleIcon, SmileyIcon, UserIcon, XCircleIcon } from '@phosphor-icons/react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { useRoom } from '@/state/RoomContext';
import type { PresenceStatus } from '@/shared/types/protocol';
import { StatusDot } from './StatusDot';
import { CustomStatusText } from './CustomStatusText';
import { CustomStatusDialog } from './CustomStatusDialog';
import { STATUS_CHOICES, liveCustomStatus } from './statusDisplay';

/** The user panel's menu: your profile, your custom status and the four statuses. `trigger` is the
 * panel's avatar-and-name button; the menu replaces what clicking it used to do (open the profile),
 * which is now the menu's first item. */
export function StatusMenu({ trigger, onOpenProfile, side = 'top', onError }: {
  trigger: ReactElement;
  onOpenProfile: () => void;
  side?: 'top' | 'right';
  /** a refused or unanswered change, already worded for the user */
  onError: (message: string) => void;
}) {
  const { t } = useTranslation('status');
  const { ownStatus, setPresence } = useRoom();
  const [editorOpen, setEditorOpen] = useState(false);
  const custom = liveCustomStatus(ownStatus.customStatus);

  function change(patch: Parameters<typeof setPresence>[0]) {
    setPresence(patch).catch((err: unknown) => onError(err instanceof Error ? err.message : t('errors.saveFailed')));
  }

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent side={side} align="start" sideOffset={8} className="w-72 p-1.5">
          <DropdownMenuItem onClick={onOpenProfile}>
            <UserIcon size={18} />
            {t('menu.viewProfile')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditorOpen(true)} className="whitespace-normal">
            {custom ? <PencilSimpleIcon size={18} /> : <SmileyIcon size={18} />}
            {custom
              ? <span className="min-w-0 flex-1"><CustomStatusText custom={custom} /><span className="sr-only">{t('menu.editCustom')}</span></span>
              : t('menu.setCustom')}
          </DropdownMenuItem>
          {custom && (
            <DropdownMenuItem onClick={() => change({ customStatus: null })}>
              <XCircleIcon size={18} />
              {t('menu.clearCustom')}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-caption font-semibold uppercase tracking-wide">{t('menu.status')}</DropdownMenuLabel>
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
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomStatusDialog open={editorOpen} onOpenChange={setEditorOpen} />
    </>
  );
}

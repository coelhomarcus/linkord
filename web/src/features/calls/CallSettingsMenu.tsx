import { ChartLineIcon, ImageIcon, SlidersHorizontalIcon, VideoCameraSlashIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRoom } from '@/state/RoomContext';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSwitchItem, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';

interface CallSettingsMenuProps {
  /** The bar's own button look, so this sits among the other controls. */
  triggerClassName: string;
}

/** How the call is shown to me — the same switches as Settings > Preferences,
 * within reach while the call is on screen. */
export function CallSettingsMenu({ triggerClassName }: CallSettingsMenuProps) {
  const { t } = useTranslation('calls');
  const {
    showTileBanners, setShowTileBanners, hideAudioOnlyTiles, setHideAudioOnlyTiles, showStats, setShowStats, fullscreenElement,
  } = useRoom();
  const label = t('controls.callSettings');
  const [open, setOpen] = useState(false);

  return (
    // Not modal: a modal menu laid a full-screen backdrop over the call with a
    // hole cut where the trigger stood when it rendered. Clicking the trigger
    // to close could land on that backdrop instead (closing the menu) and then
    // reach the trigger too (opening it again), so it flickered shut, open and
    // shut. Without the backdrop the trigger alone toggles it; a press outside
    // and Esc still close it.
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      {/* the tooltip sits where the menu opens: while the menu is up it would
          pop over it every time the pointer came back to the button */}
      <Tooltip disabled={open}>
        <TooltipTrigger render={<DropdownMenuTrigger aria-label={label} className={triggerClassName} />}>
          <SlidersHorizontalIcon className="size-[22px] max-[480px]:size-5 max-[360px]:size-[19px]" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" container={fullscreenElement ?? undefined} className="min-w-80 max-w-[calc(100vw-1.5rem)] p-1.5">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-2 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide">{t('callSettings.title')}</DropdownMenuLabel>
          <DropdownMenuSwitchItem checked={hideAudioOnlyTiles} onCheckedChange={setHideAudioOnlyTiles}>
            <VideoCameraSlashIcon size={16} />
            {t('callSettings.hideAudioOnly')}
          </DropdownMenuSwitchItem>
          <DropdownMenuSwitchItem checked={showTileBanners} onCheckedChange={setShowTileBanners}>
            <ImageIcon size={16} />
            {t('callSettings.banners')}
          </DropdownMenuSwitchItem>
          <DropdownMenuSwitchItem checked={showStats} onCheckedChange={setShowStats}>
            <ChartLineIcon size={16} />
            {t('callSettings.stats')}
          </DropdownMenuSwitchItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

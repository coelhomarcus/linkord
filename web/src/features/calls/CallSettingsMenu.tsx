import { ChartLineIcon, ImageIcon, SlidersHorizontalIcon, VideoCameraSlashIcon } from '@phosphor-icons/react';
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

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger render={<DropdownMenuTrigger aria-label={label} className={triggerClassName} />}>
          <SlidersHorizontalIcon className="size-[22px] max-[480px]:size-5 max-[360px]:size-[19px]" />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent side="top" align="end" container={fullscreenElement ?? undefined} className="w-80 max-w-[calc(100vw-1.5rem)] p-1.5">
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

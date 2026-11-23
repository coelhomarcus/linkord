import { DownloadSimpleIcon } from '@/shared/ui/icons';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { useDesktopUpdate } from './useDesktopUpdate';

/**
 * Discord's green arrow in the title bar: a downloaded update of the desktop
 * app, installed by restarting. Nothing until there is one.
 */
export function DesktopUpdateButton({ className }: { className?: string }) {
  const { t } = useTranslation('desktopApp');
  const { status, apply } = useDesktopUpdate();
  if (status?.kind !== 'downloaded') return null;
  return (
    <Tooltip>
      <TooltipTrigger
        aria-label={t('updateReady')}
        onClick={apply}
        className={cn('app-no-drag grid size-7 flex-none place-items-center rounded-md text-green transition-colors hover:bg-bg-control-hover', className)}
      >
        <DownloadSimpleIcon size={20} weight="fill" />
      </TooltipTrigger>
      <TooltipContent side="bottom">{t('updateReady')}</TooltipContent>
    </Tooltip>
  );
}

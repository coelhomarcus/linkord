import { useTranslation } from 'react-i18next';

import {
  DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { cn } from '@/shared/lib/utils';

const PLAYBACK_RATES = [0.75, 1, 1.5, 2] as const;

interface PlaybackRateMenuProps {
  rate: number;
  onRateChange: (rate: number) => void;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}

export function PlaybackRateMenu({ rate, onRateChange, onOpenChange, className }: PlaybackRateMenuProps) {
  const { t, i18n } = useTranslation('media');
  const format = (value: number) => t('player.rateValue', { rate: new Intl.NumberFormat(i18n.language).format(value) });

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        aria-label={t('player.playbackRateValue', { rate: format(rate) })}
        className={cn(
          'flex h-7 min-w-7 flex-none items-center justify-center rounded-md px-1 text-caption font-semibold tabular-nums outline-none transition-colors duration-100 hover:bg-white/10 hover:text-white focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-white/10 data-popup-open:text-white',
          className,
        )}
      >
        {format(rate)}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="min-w-36">
        <DropdownMenuRadioGroup value={rate} onValueChange={(value) => onRateChange(Number(value))}>
          <DropdownMenuLabel>{t('player.playbackRate')}</DropdownMenuLabel>
          {PLAYBACK_RATES.map((value) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {value === 1 ? t('player.normalRate', { rate: format(value) }) : format(value)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { DotsThreeIcon } from '@phosphor-icons/react';
import type { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/lib/utils';
import type { AnchorRect } from '@/state/RoomContext';

/** The way to TileMenu without right-click or long press: keyboard and screen
 * reader users (VoiceOver and TalkBack do not pass a long press through the
 * same way). Invisible until it has keyboard focus, so it never covers video;
 * a screen reader still finds it. */
export function TileMenuButton({ name, onOpen, className }: {
  name: string;
  onOpen: (rect: AnchorRect) => void;
  className?: string;
}) {
  const { t } = useTranslation('calls');
  const open = (event: MouseEvent<HTMLButtonElement>) => {
    // not the tile's own click, which toggles focus
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    onOpen({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
  };
  return (
    <button
      type="button"
      aria-label={t('tile.moreActions', { name })}
      aria-haspopup="menu"
      onClick={open}
      className={cn(
        'pointer-events-none absolute z-10 grid size-7 place-items-center rounded-md border border-white/10 bg-black/85 text-white opacity-0 outline-none',
        'focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    >
      <DotsThreeIcon size={18} weight="bold" />
    </button>
  );
}

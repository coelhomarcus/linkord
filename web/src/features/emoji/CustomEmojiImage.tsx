import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { useOptionalRoomSelector } from '@/state/RoomContext';
import { ExpressionDetails } from './ExpressionPopover';
import { EXPRESSION_POPOVER_CLASS, useExpressionOrigin } from './expressionOrigin';
import { useKnownCustomEmoji, useMyEmojis } from './myEmojis';
import { emojiImageUrl } from './serverEmojisApi';

const SIZES = {
  // the line's own height, sitting on the text like a glyph
  inline: 'inline-block size-[1.375em] align-[-0.3em]',
  jumbo: 'inline-block size-12 align-bottom',
  reaction: 'inline-block size-4',
} as const;

interface CustomEmojiImageProps {
  id: string;
  name: string;
  size?: keyof typeof SIZES;
  /** off where something around it already explains it (a reaction chip) */
  tooltip?: boolean;
  /** a click opens what it is and where it comes from (in message text) */
  details?: boolean;
  className?: string;
}

/** A server emoji, from anywhere it shows up. Its tooltip names it; in a
 * message, a click tells where it comes from. An emoji that no longer exists
 * reads as its `:name:`. */
export function CustomEmojiImage({ id, name, size = 'inline', tooltip = true, details = false, className }: CustomEmojiImageProps) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const known = useKnownCustomEmoji(id);
  const label = `:${known?.name ?? name}:`;
  if (broken) return <span className={className}>{label}</span>;
  const image = (
    <img
      src={emojiImageUrl(id)}
      alt={label}
      draggable={false}
      loading="lazy"
      onError={() => setBroken(true)}
      className={cn(details ? 'size-full' : SIZES[size], 'object-contain', className)}
    />
  );
  const tooltipContent = <TooltipContent className="font-semibold">{label}</TooltipContent>;
  if (!details) {
    if (!tooltip) return image;
    return (
      <Tooltip>
        <TooltipTrigger delay={300} render={image} />
        {tooltipContent}
      </Tooltip>
    );
  }
  // the box and its place on the line move to the button, the picture fills it
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip disabled={open || !tooltip}>
        <TooltipTrigger delay={300} render={<PopoverTrigger className={cn(SIZES[size], 'select-text rounded-sm focus-ring')} />}>
          {image}
        </TooltipTrigger>
        {tooltipContent}
      </Tooltip>
      <PopoverContent side="top" align="start" className={EXPRESSION_POPOVER_CLASS}>
        <CustomEmojiDetails id={id} label={label} />
      </PopoverContent>
    </Popover>
  );
}

/** Mounted only while the popover is open: that is when the account's
 * emoji list has to be read, if nothing else has asked for it yet. */
function CustomEmojiDetails({ id, label }: { id: string; label: string }) {
  const { t } = useTranslation('emoji');
  const mine = useMyEmojis(useOptionalRoomSelector((room) => room.state.me.userId) ?? null);
  const known = useKnownCustomEmoji(id);
  const origin = useExpressionOrigin(known?.serverId, mine.status === 'ready');
  return (
    <ExpressionDetails
      picture={<img src={emojiImageUrl(id)} alt="" draggable={false} className="size-12 object-contain" />}
      name={label}
      description={origin ? t(`details.custom.${origin.kind}`) : undefined}
      sourceLabel={t('details.custom.source')}
      server={origin && origin.kind !== 'elsewhere' ? origin.server : undefined}
    />
  );
}

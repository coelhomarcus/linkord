import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { RoomContext } from '@/state/RoomContext';
import { useKnownCustomEmoji } from './myEmojis';
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
  className?: string;
}

/** A server emoji, from anywhere it shows up. Its tooltip names it, and the
 * server it comes from when the viewer is a member there. An emoji that no
 * longer exists reads as its `:name:`. */
export function CustomEmojiImage({ id, name, size = 'inline', tooltip = true, className }: CustomEmojiImageProps) {
  const { t } = useTranslation('emoji');
  const [broken, setBroken] = useState(false);
  const known = useKnownCustomEmoji(id);
  const server = useContext(RoomContext)?.servers.find((s) => s.id === known?.serverId);
  const label = `:${known?.name ?? name}:`;
  if (broken) return <span className={className}>{label}</span>;
  const image = (
    <img
      src={emojiImageUrl(id)}
      alt={label}
      draggable={false}
      loading="lazy"
      onError={() => setBroken(true)}
      className={cn(SIZES[size], 'object-contain', className)}
    />
  );
  if (!tooltip) return image;
  return (
    <Tooltip>
      <TooltipTrigger delay={300} render={image} />
      <TooltipContent className="flex flex-col items-center gap-0.5 text-center">
        <span className="font-semibold">{label}</span>
        {server && <span className="text-caption text-text-muted">{t('custom.from', { server: server.name })}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

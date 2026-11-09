import { useTranslation } from 'react-i18next';
import { PlusIcon } from '@phosphor-icons/react';

import { cn } from '@/shared/lib/utils';
import { Emoji } from '@/features/emoji/Emoji';

// A short fixed set shown first, instead of mounting the full picker (and
// fetching its emoji dataset, see features/emoji/emojiData.ts)
// on every single open — most reactions are one of these anyway. The full
// picker only mounts once "+" is actually clicked.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export function QuickReactionRow({ onPick, onMore, className }: { onPick: (emoji: string) => void; onMore: () => void; className?: string }) {
  const { t } = useTranslation('chat');
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          aria-label={t('reactWith', { emoji })}
          // Discord's quick reactions: square tiles at the top of the menu
          className="grid size-9 place-items-center rounded-lg bg-bg-control text-[20px] leading-none transition-colors hover:bg-bg-control-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Emoji emoji={emoji} />
        </button>
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-label={t('moreEmojis')}
        className="grid size-9 place-items-center rounded-lg bg-bg-control text-text-secondary transition-colors hover:bg-bg-control-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <PlusIcon size={18} />
      </button>
    </div>
  );
}

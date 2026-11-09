import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/shared/lib/utils';
import { emojiOptionId } from './emojiAutocomplete';
import { Emoji } from '@/features/emoji/Emoji';

export interface EmojiSuggestionItem {
  key: string;
  shortcode: string;
  /** a Unicode emoji, or… */
  emoji?: string;
  /** …a server emoji's image */
  imageUrl?: string;
  /** where a server emoji comes from */
  detail?: string;
}

interface EmojiSuggestionsProps {
  id: string;
  query: string;
  items: EmojiSuggestionItem[];
  activeIndex: number;
  onPick: (item: EmojiSuggestionItem) => void;
  onHover: (index: number) => void;
}

/** The list above the composer while a ":shortcode" is being typed. Focus
 * never leaves the field: it points at the active option through
 * aria-activedescendant. */
export function EmojiSuggestions({ id, query, items, activeIndex, onPick, onHover }: EmojiSuggestionsProps) {
  const { t } = useTranslation('chat');
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, items]);

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-[min(22rem,45dvh)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-surface-overlay py-1 shadow-popover">
      <p aria-hidden className="select-none truncate px-3 pb-1 pt-0.5 text-caption font-semibold uppercase text-text-muted">
        {t('composer.emojiSuggestions.title', { query: `:${query}` })}
      </p>
      <div id={id} role="listbox" aria-label={t('composer.emojiSuggestions.label')}>
        {items.map((item, i) => (
          <div
            key={item.key}
            ref={(el) => { optionRefs.current[i] = el; }}
            id={emojiOptionId(id, i)}
            role="option"
            aria-selected={i === activeIndex}
            // keeps the caret (and a phone's keyboard) in the field; the pick
            // waits for the click, so a swipe that scrolls the list picks nothing
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(item)}
            onPointerMove={() => { if (i !== activeIndex) onHover(i); }}
            className={cn(
              'flex min-h-9 cursor-pointer items-center gap-2.5 px-3 py-1 touch-first:min-h-11',
              i === activeIndex ? 'bg-fill-hover text-text-primary' : 'text-text-secondary',
            )}
          >
            {item.imageUrl
              ? <img src={item.imageUrl} alt="" className="size-6 flex-none object-contain" draggable={false} />
              : <span className="w-6 flex-none text-center text-[20px] leading-none"><Emoji emoji={item.emoji!} /></span>}
            <span className="min-w-0 flex-1 truncate text-label font-medium">:{item.shortcode}:</span>
            {item.detail && <span className="max-w-[40%] flex-none truncate text-caption text-text-muted">{item.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

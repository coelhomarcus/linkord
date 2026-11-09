import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GifConfig } from '@/shared/api/api';
import { cn } from '@/shared/lib/utils';
import { EmojiPicker, type EmojiPick } from '@/features/emoji/EmojiPicker';
import { GifPicker } from '@/features/gifs/GifPicker';
import type { Gif } from '@/features/gifs/klipy';

export type ExpressionTab = 'gifs' | 'emoji';

interface ExpressionPickerProps {
  tab: ExpressionTab;
  onTabChange: (tab: ExpressionTab) => void;
  gifConfig: GifConfig | null | undefined;
  onGif: (gif: Gif, query: string) => void;
  onEmoji: (pick: EmojiPick) => void;
  className?: string;
  /** off in the phone sheet: a focused search would open the keyboard over the emojis */
  autoFocus?: boolean;
}

/** The composer's expressions, Discord-style: GIFs and emojis behind tabs in
 * one panel (stickers would be a third). Without GIFs configured, it is the
 * emoji picker alone. */
export function ExpressionPicker({ tab, onTabChange, gifConfig, onGif, onEmoji, className, autoFocus = true }: ExpressionPickerProps) {
  const { t } = useTranslation('chat');
  const gifs = gifConfig?.enabled ? gifConfig : null;
  // a tab is only mounted once it has been shown, and then kept
  const [seen, setSeen] = useState<ReadonlySet<ExpressionTab>>(() => new Set([tab]));
  if (!seen.has(tab)) setSeen(new Set([...seen, tab]));
  if (!gifs) return <EmojiPicker onPick={onEmoji} className={className} autoFocus={autoFocus} />;

  const tabs: ExpressionTab[] = ['gifs', 'emoji'];
  return (
    <div className={cn('flex w-full flex-col', className)}>
      <div role="tablist" aria-label={t('expressions.label')} className="flex flex-none gap-1 px-3 pt-3">
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`expression-tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`expression-panel-${key}`}
            onClick={() => onTabChange(key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-label font-semibold transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === key ? 'bg-fill-hover text-text-primary' : 'text-text-secondary hover:bg-fill-subtle hover:text-text-primary',
            )}
          >
            {t(`expressions.${key}`)}
          </button>
        ))}
      </div>
      {seen.has('gifs') && (
        <div role="tabpanel" id="expression-panel-gifs" aria-labelledby="expression-tab-gifs" hidden={tab !== 'gifs'}>
          <GifPicker config={gifs} onPick={onGif} />
        </div>
      )}
      {seen.has('emoji') && (
        <div role="tabpanel" id="expression-panel-emoji" aria-labelledby="expression-tab-emoji" hidden={tab !== 'emoji'}>
          <EmojiPicker onPick={onEmoji} autoFocus={autoFocus && tab === 'emoji'} />
        </div>
      )}
    </div>
  );
}

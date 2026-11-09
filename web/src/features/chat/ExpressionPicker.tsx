import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { GifConfig } from '@/shared/api/api';
import { cn } from '@/shared/lib/utils';
import { EmojiPicker, type EmojiPick } from '@/features/emoji/EmojiPicker';
import { GifPicker } from '@/features/gifs/GifPicker';
import type { Gif } from '@/features/gifs/klipy';
import { StickerPicker } from '@/features/stickers/StickerPicker';
import type { MySticker } from '@/features/stickers/myStickers';

export type ExpressionTab = 'gifs' | 'stickers' | 'emoji';

interface ExpressionPickerProps {
  tab: ExpressionTab;
  onTabChange: (tab: ExpressionTab) => void;
  gifConfig: GifConfig | null | undefined;
  onGif: (gif: Gif, query: string) => void;
  onSticker: (sticker: MySticker) => void;
  onEmoji: (pick: EmojiPick) => void;
  className?: string;
  /** off in the phone sheet: a focused search would open the keyboard over the emojis */
  autoFocus?: boolean;
}

/** The composer's expressions, Discord-style: GIFs, stickers and emojis
 * behind tabs in one panel. Without GIFs configured, their tab is left out. */
export function ExpressionPicker({ tab, onTabChange, gifConfig, onGif, onSticker, onEmoji, className, autoFocus = true }: ExpressionPickerProps) {
  const { t } = useTranslation('chat');
  const gifs = gifConfig?.enabled ? gifConfig : null;
  const tabs: ExpressionTab[] = gifs ? ['gifs', 'stickers', 'emoji'] : ['stickers', 'emoji'];
  const current = tabs.includes(tab) ? tab : 'emoji';
  // a tab is only mounted once it has been shown, and then kept
  const [seen, setSeen] = useState<ReadonlySet<ExpressionTab>>(() => new Set([current]));
  if (!seen.has(current)) setSeen(new Set([...seen, current]));

  return (
    <div className={cn('flex w-full flex-col', className)}>
      <div role="tablist" aria-label={t('expressions.label')} className="flex flex-none gap-1 px-3 pt-3">
        {tabs.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`expression-tab-${key}`}
            aria-selected={current === key}
            aria-controls={`expression-panel-${key}`}
            onClick={() => onTabChange(key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-label font-semibold transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              current === key ? 'bg-fill-hover text-text-primary' : 'text-text-secondary hover:bg-fill-subtle hover:text-text-primary',
            )}
          >
            {t(`expressions.${key}`)}
          </button>
        ))}
      </div>
      {gifs && seen.has('gifs') && (
        <div role="tabpanel" id="expression-panel-gifs" aria-labelledby="expression-tab-gifs" hidden={current !== 'gifs'}>
          <GifPicker config={gifs} onPick={onGif} />
        </div>
      )}
      {seen.has('stickers') && (
        <div role="tabpanel" id="expression-panel-stickers" aria-labelledby="expression-tab-stickers" hidden={current !== 'stickers'}>
          <StickerPicker onPick={onSticker} autoFocus={autoFocus && current === 'stickers'} />
        </div>
      )}
      {seen.has('emoji') && (
        <div role="tabpanel" id="expression-panel-emoji" aria-labelledby="expression-tab-emoji" hidden={current !== 'emoji'}>
          <EmojiPicker onPick={onEmoji} autoFocus={autoFocus && current === 'emoji'} />
        </div>
      )}
    </div>
  );
}

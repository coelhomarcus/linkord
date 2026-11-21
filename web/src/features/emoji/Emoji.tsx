import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { cn } from '@/shared/lib/utils';
import { useEmojiData } from './emojiData';
import { ExpressionDetails } from './ExpressionPopover';
import { EXPRESSION_POPOVER_CLASS } from './expressionOrigin';
import { resolveTwemoji, resolvedTwemoji, splitEmoji, twemojiUrls, useResolvedTwemoji } from './twemoji';

interface EmojiProps {
  emoji: string;
  /** the box, in em of the surrounding text: 1 in a button or a picker, larger inside a sentence */
  className?: string;
}

/** A Unicode emoji as its Twemoji picture. The character stays in the page,
 * transparent under the picture: copying, searching and screen readers get
 * the real emoji. One Twemoji lacks falls back to the system's font. */
export function Emoji({ emoji, className }: EmojiProps) {
  const state = useResolvedTwemoji(emoji);
  useEffect(() => {
    if (!resolvedTwemoji(emoji)) void resolveTwemoji(emoji);
  }, [emoji]);

  if (state === 'missing') return <span className={className}>{emoji}</span>;
  // until it is known which file exists, the likely one is drawn already
  const url = state?.url ?? twemojiUrls(emoji)[0]!;
  const style: CSSProperties = { backgroundImage: `url("${url}")` };
  return (
    <span
      data-emoji
      style={style}
      className={cn(
        'inline-block size-[1em] overflow-hidden bg-contain bg-center bg-no-repeat align-[-0.125em] text-[1em] leading-none text-transparent select-text',
        className,
      )}
    >
      {emoji}
    </span>
  );
}

/** Text with its Unicode emojis drawn as Twemoji, the rest left as it is.
 * `details`: a click on one says what it is (in message text). */
export function EmojiText({ text, emojiClassName, details = false }: { text: string; emojiClassName?: string; details?: boolean }) {
  const parts = splitEmoji(text);
  if (parts.length === 1 && typeof parts[0] === 'string') return <>{text}</>;
  return (
    <>
      {parts.map((part, index) => {
        if (typeof part === 'string') return part;
        return details
          ? <StandardEmojiButton key={index} emoji={part.emoji} className={emojiClassName} />
          : <Emoji key={index} emoji={part.emoji} className={emojiClassName} />;
      })}
    </>
  );
}

function StandardEmojiButton({ emoji, className }: { emoji: string; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger className="select-text rounded-sm focus-ring">
        <Emoji emoji={emoji} className={className} />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className={EXPRESSION_POPOVER_CLASS}>
        <StandardEmojiDetails emoji={emoji} />
      </PopoverContent>
    </Popover>
  );
}

/** Mounted only while open: the emoji dataset (its `:name:`) is fetched the
 * first time someone asks. */
function StandardEmojiDetails({ emoji }: { emoji: string }) {
  const { t } = useTranslation('emoji');
  const data = useEmojiData();
  const shortcode = data?.byEmoji.get(emoji)?.shortcodes[0];
  return (
    <ExpressionDetails
      // off-scale: a glyph drawn as a 48px picture, not type
      picture={<span className="text-[48px] leading-none"><Emoji emoji={emoji} /></span>}
      name={shortcode ? `:${shortcode}:` : emoji}
      description={t('details.standard')}
    />
  );
}

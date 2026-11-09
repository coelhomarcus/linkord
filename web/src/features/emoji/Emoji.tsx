import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import { cn } from '@/shared/lib/utils';
import { resolveTwemoji, resolvedTwemoji, splitEmoji, twemojiUrls } from './twemoji';

interface EmojiProps {
  emoji: string;
  /** the box, in em of the surrounding text: 1 in a button or a picker, larger inside a sentence */
  className?: string;
}

/** A Unicode emoji as its Twemoji picture. The character stays in the page,
 * transparent under the picture: copying, searching and screen readers get
 * the real emoji. One Twemoji lacks falls back to the system's font. */
export function Emoji({ emoji, className }: EmojiProps) {
  // bumped when this emoji's file is found; the answer itself lives in twemoji.ts
  const [, setFound] = useState(0);
  useEffect(() => {
    let live = true;
    if (!resolvedTwemoji(emoji)) void resolveTwemoji(emoji).then(() => { if (live) setFound((n) => n + 1); });
    return () => { live = false; };
  }, [emoji]);
  const state = resolvedTwemoji(emoji);

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

/** Text with its Unicode emojis drawn as Twemoji, the rest left as it is. */
export function EmojiText({ text, emojiClassName }: { text: string; emojiClassName?: string }) {
  const parts = splitEmoji(text);
  if (parts.length === 1 && typeof parts[0] === 'string') return <>{text}</>;
  return (
    <>
      {parts.map((part, index) => (typeof part === 'string' ? part : <Emoji key={index} emoji={part.emoji} className={emojiClassName} />))}
    </>
  );
}

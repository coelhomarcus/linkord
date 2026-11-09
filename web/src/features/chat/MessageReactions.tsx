import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { reactionParticipantNames, reactionSummarySentence, summarizeReactionParticipants } from './reactionParticipants';
import type { PublicUser, ReactionEmoji } from '@/shared/types/protocol';
import { CustomEmojiImage } from '@/features/emoji/CustomEmojiImage';
import { customReactionId } from '@/features/emoji/customEmojiText';
import { useCustomEmojiName } from '@/features/emoji/emojiNames';
import { Emoji } from '@/features/emoji/Emoji';

interface MessageReactionsProps {
  reactions: Partial<Record<ReactionEmoji, string[]>>;
  myUserId: string | null;
  allUsers: Map<string, PublicUser>;
  onToggle: (emoji: ReactionEmoji) => void;
}

/** A reaction as it reads: the emoji itself, or a server emoji's picture
 * (with its :name: as the words a screen reader and a tooltip use). */
function useReactionLabel(emoji: ReactionEmoji): string {
  const customId = customReactionId(emoji);
  const name = useCustomEmojiName(customId ?? '');
  return customId ? `:${name ?? 'emoji'}:` : emoji;
}

function ReactionGlyph({ emoji, label }: { emoji: ReactionEmoji; label: string }) {
  const customId = customReactionId(emoji);
  return customId ? <CustomEmojiImage id={customId} name={label.slice(1, -1)} size="reaction" tooltip={false} /> : <Emoji emoji={emoji} className="size-4" />;
}

type ReactionEntry = [ReactionEmoji, string[]];

interface LeavingChip {
  emoji: ReactionEmoji;
  userIds: string[];
  /** where it sat, so it fades out in place instead of jumping to the end */
  index: number;
}

interface Tracked {
  /** what the last render showed: the baseline a change is measured against */
  snapshot: ReactionEntry[];
  /** chips that appeared after the message was on screen; history never lands here */
  entering: ReadonlySet<ReactionEmoji>;
  leaving: LeavingChip[];
}

function sameShape(a: ReactionEntry[], b: ReactionEntry[]) {
  return a.length === b.length && a.every(([emoji, userIds], i) => emoji === b[i]![0] && userIds.length === b[i]![1].length);
}

function advance(previous: Tracked, entries: ReactionEntry[]): Tracked {
  const before = new Set(previous.snapshot.map(([emoji]) => emoji));
  const after = new Set(entries.map(([emoji]) => emoji));
  const entering = new Set([...previous.entering].filter((emoji) => after.has(emoji)));
  for (const emoji of after) if (!before.has(emoji)) entering.add(emoji);
  const leaving = previous.leaving.filter((chip) => !after.has(chip.emoji));
  previous.snapshot.forEach(([emoji, userIds], index) => { if (!after.has(emoji)) leaving.push({ emoji, userIds, index }); });
  return { snapshot: entries, entering, leaving };
}

export function MessageReactions({ reactions, myUserId, allUsers, onToggle }: MessageReactionsProps) {
  const entries = (Object.entries(reactions) as ReactionEntry[]).filter(([, userIds]) => userIds?.length);
  // The first render is the baseline (a message loaded from history, or scrolled back into view, plays
  // nothing); only a change after that animates. Derived during render so the chip carries its attribute from
  // its very first paint.
  const [tracked, setTracked] = useState<Tracked>(() => ({ snapshot: entries, entering: new Set(), leaving: [] }));
  let view = tracked;
  if (!sameShape(tracked.snapshot, entries)) {
    view = advance(tracked, entries);
    setTracked(view);
  }
  const onGone = useCallback((emoji: ReactionEmoji) => {
    setTracked((current) => ({ ...current, leaving: current.leaving.filter((chip) => chip.emoji !== emoji) }));
  }, []);

  const items = entries.map(([emoji, userIds]) => ({ emoji, userIds, leaving: false }));
  for (const chip of [...view.leaving].sort((a, b) => a.index - b.index)) {
    items.splice(Math.min(chip.index, items.length), 0, { emoji: chip.emoji, userIds: chip.userIds, leaving: true });
  }
  if (!items.length) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {items.map((item) => (
        <ReactionChip key={item.emoji} emoji={item.emoji} userIds={item.userIds} entering={view.entering.has(item.emoji)} leaving={item.leaving} onGone={onGone} myUserId={myUserId} allUsers={allUsers} onToggle={onToggle} />
      ))}
    </div>
  );
}

// Entrance 200 ms and exit 100 ms (DURATION in shared/lib/ease.ts). Under reduced motion the enter/exit
// keyframes keep only the fade (styles/index.css). fill-mode keeps the chip hidden between the end of the
// exit and the unmount.
const CHIP_MOTION = 'ease-out-expo data-entering:animate-in data-entering:fade-in-0 data-entering:zoom-in-75 data-entering:duration-200 data-closed:animate-out data-closed:fade-out-0 data-closed:duration-100 data-closed:fill-mode-forwards';
// the new number comes in from the side the count moved towards
const COUNT_MOTION = 'ease-out-expo data-[roll]:animate-in data-[roll]:fade-in-0 data-[roll]:duration-200 data-[roll=up]:slide-in-from-bottom-2 data-[roll=down]:slide-in-from-top-2';

interface ReactionChipProps extends Omit<MessageReactionsProps, 'reactions'> {
  emoji: ReactionEmoji;
  userIds: string[];
  entering: boolean;
  /** the reaction was removed: the chip fades out with the count it had, taking no input, then calls `onGone` */
  leaving: boolean;
  onGone: (emoji: ReactionEmoji) => void;
}

function ReactionChip({ emoji, userIds, entering, leaving, onGone, myUserId, allUsers, onToggle }: ReactionChipProps) {
  const { t } = useTranslation('chat');
  const label = useReactionLabel(emoji);
  const ref = useRef<HTMLSpanElement>(null);
  const count = userIds.length;
  const [counted, setCounted] = useState<{ count: number; roll: 'up' | 'down' | null }>({ count, roll: null });
  let roll = counted.roll;
  if (counted.count !== count) {
    roll = count > counted.count ? 'up' : 'down';
    setCounted({ count, roll });
  }

  // Waits for the exit to end. Where nothing animates (jsdom has no getAnimations) it goes in the same commit.
  useLayoutEffect(() => {
    if (!leaving) return;
    const animations = ref.current?.getAnimations?.() ?? [];
    if (animations.length === 0) {
      onGone(emoji);
      return;
    }
    let cancelled = false;
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => { if (!cancelled) onGone(emoji); });
    return () => { cancelled = true; };
  }, [leaving, emoji, onGone]);

  const mine = !!myUserId && userIds.includes(myUserId);
  const names = reactionParticipantNames(userIds, allUsers, myUserId);
  return (
    <span
      ref={ref}
      className={cn('inline-flex', CHIP_MOTION)}
      data-entering={entering && !leaving ? '' : undefined}
      data-closed={leaving ? '' : undefined}
      inert={leaving}
    >
      <Tooltip>
        <TooltipTrigger
          // longer than the app's ambient tooltips (0ms): a quick pass
          // over the message shouldn't pop one for every chip it crosses
          delay={400}
          closeDelay={150}
          render={
            <button
              type="button"
              aria-pressed={mine}
              aria-label={t(mine ? 'reactions.chipRemove' : 'reactions.chipAdd', { emoji: label, count, names: summarizeReactionParticipants(names) })}
              onClick={() => onToggle(emoji)}
              className={cn(
                'flex h-6 items-center gap-1 rounded-full border px-1.5 text-label transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                mine ? 'border-primary/50 bg-primary/15 text-text-primary' : 'border-border bg-fill-subtle text-text-secondary hover:bg-fill-hover'
              )}
            />
          }
        >
          <ReactionGlyph emoji={emoji} label={label} />
          {/* fixed box so a count going 9 → 10 doesn't shift the chips */}
          <span className="relative inline-grid min-w-[1ch] overflow-hidden tabular-nums">
            {/* keyed by the number: a change remounts it and plays the roll; the first paint has no data-roll */}
            <span key={count} data-roll={leaving ? undefined : (roll ?? undefined)} className={COUNT_MOTION}>{count}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <span aria-hidden>{customReactionId(emoji) ? label : emoji}</span> {reactionSummarySentence(names)}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { TOUCH_FIRST_QUERY } from '@/shared/hooks/useLongPress';
import { EmojiPicker } from '@/features/emoji/EmojiPicker';
import { QuickReactionRow } from './QuickReactionRow';
import { openReactionSheet } from './reactionSheet';

interface ReactionEmojiPickerProps {
  /** Whether the full picker (as opposed to the quick row) is what should
   * currently be visible. */
  fullPickerOpen: boolean;
  /** From `useKeepPopoverWarm(fullPickerOpen)` in the caller — passed in
   * rather than computed here so the caller can also give the SAME value to
   * its `PopoverContent`/`ContextMenuContent`'s own `keepMounted`, keeping
   * one source of truth for "has this ever been opened". */
  warmed: boolean;
  /** a reaction's value: the emoji, or custom:<id> for a server emoji */
  onPick: (reaction: string) => void;
  onMore: () => void;
  /** closes the menu around it: on a touch screen "more" opens a sheet instead */
  onClose?: () => void;
  quickRowClassName?: string;
}

/** The quick-reaction row that escalates to the full emoji picker on "mais"
 * — shared by MessageRow's reaction popover and GlobalContextMenu's message
 * block. Once the full picker has been opened once, it stays mounted
 * (hidden via `hidden`, not torn down), so its scroll and search survive the
 * next open — see useKeepPopoverWarm. Toggling `hidden` here (a plain DOM
 * attribute, not conditional rendering) is what actually keeps it alive
 * across opens: the enclosing Popover/ContextMenu's own `keepMounted` only
 * stops IT from unmounting the content on close. On a touch screen the full
 * picker is a bottom sheet instead (ReactionSheetHost). */
export function ReactionEmojiPicker({ fullPickerOpen, warmed, onPick, onMore, onClose, quickRowClassName }: ReactionEmojiPickerProps) {
  const touchFirst = useMediaQuery(TOUCH_FIRST_QUERY);
  function more() {
    if (!touchFirst) { onMore(); return; }
    onClose?.();
    openReactionSheet(onPick);
  }
  return (
    <>
      {!fullPickerOpen && <QuickReactionRow className={quickRowClassName} onPick={onPick} onMore={more} />}
      {warmed && (
        <div hidden={!fullPickerOpen}>
          <EmojiPicker className="h-96" onPick={(pick) => onPick(pick.key)} autoFocus={fullPickerOpen} />
        </div>
      )}
    </>
  );
}

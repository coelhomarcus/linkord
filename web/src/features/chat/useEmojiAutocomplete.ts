import { useCallback, useId, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useEmojiData } from '@/features/emoji/emojiData';
import { suggestShortcodes, withSkinTone } from '@/features/emoji/emojiSearch';
import { noteExpressionUse, useFrequentExpressions } from '@/features/emoji/frequentExpressions';
import { useSkinTone } from '@/features/emoji/skinTone';
import { completeClosedShortcode, emojiOptionId, getEmojiQuery, insertAtQuery, type EmojiQuery, type TextEdit } from './emojiAutocomplete';
import type { EmojiSuggestionItem } from './EmojiSuggestions';

const MAX_SUGGESTIONS = 8;

/** The composer's ":shortcode" suggestions: what the list shows, the keys it
 * takes over while open, and the edits a pick or a closing ":" makes. The
 * caller owns the text and applies the edits. */
export function useEmojiAutocomplete(accountId: string | null) {
  const listId = useId();
  const [query, setQuery] = useState<EmojiQuery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // fetched the first time a ":query" shows up, not on every composer mount
  const data = useEmojiData(query !== null);
  const frequent = useFrequentExpressions(accountId, 'emojis', query !== null);
  const skinTone = useSkinTone();

  const items = useMemo<EmojiSuggestionItem[]>(() => {
    if (!query || !data) return [];
    return suggestShortcodes(query.query, data, frequent, MAX_SUGGESTIONS, skinTone)
      .map((s) => ({ key: s.key, shortcode: s.shortcode, emoji: s.emoji }));
  }, [query, data, frequent, skinTone]);
  const open = query !== null && items.length > 0;
  const active = Math.min(activeIndex, Math.max(0, items.length - 1));

  /** After every edit and caret move. */
  function sync(text: string, cursor: number) {
    setQuery(getEmojiQuery(text, cursor));
    setActiveIndex(0);
  }

  const close = useCallback(() => setQuery(null), []);

  /** A ":joy:" typed in full (the closing ":" being what was just typed)
   * turns into the emoji. Pastes and drops are left as they are. */
  function convertTyped(input: Event, next: string, cursor: number): TextEdit | null {
    const typed = input instanceof InputEvent && input.inputType === 'insertText' ? input.data : null;
    if (!data || !typed?.endsWith(':') || next[cursor - 1] !== ':') return null;
    return completeClosedShortcode(next, cursor, (name) => {
      const entry = data.byShortcode.get(name);
      return entry ? withSkinTone(entry, skinTone) : null;
    });
  }

  function pick(text: string, item: EmojiSuggestionItem): TextEdit | null {
    if (!query) return null;
    const edit = insertAtQuery(text, query, item.emoji ?? `:${item.shortcode}:`);
    noteExpressionUse('emojis', [item.key]);
    setQuery(null);
    return edit;
  }

  /** True when the key belonged to the list (the caller then stops there). */
  function handleKeyDown(event: ReactKeyboardEvent, text: string, apply: (edit: TextEdit) => void): boolean {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((active + 1) % items.length); return true; }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((active - 1 + items.length) % items.length); return true; }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      event.preventDefault();
      const edit = pick(text, items[active]!);
      if (edit) apply(edit);
      return true;
    }
    if (event.key === 'Escape') { event.preventDefault(); close(); return true; }
    return false;
  }

  return {
    open,
    listId,
    query: query?.query ?? '',
    items,
    activeIndex: active,
    setActiveIndex,
    sync,
    close,
    convertTyped,
    pick,
    handleKeyDown,
    /** for the field: it stays focused and names the highlighted option */
    fieldProps: {
      'aria-autocomplete': 'list' as const,
      'aria-controls': open ? listId : undefined,
      'aria-activedescendant': open ? emojiOptionId(listId, active) : undefined,
    },
  };
}

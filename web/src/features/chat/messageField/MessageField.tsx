import { useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import type { AriaAttributes, Ref } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { mergeRegister } from '@lexical/utils';
import { $getRoot, COMMAND_PRIORITY_CRITICAL, KEY_DOWN_COMMAND, PASTE_COMMAND, TextNode } from 'lexical';

import { cn } from '@/shared/lib/utils';
import { CustomEmojiNode, TwemojiNode } from './emojiNodes';
import { $convertEmojis, $fieldSelection, $fieldText, $setFieldCaret, $setFieldText, type ResolveCustomEmoji } from './fieldText';

/** What the composer used to ask its textarea, asked of the editor instead. */
export interface MessageFieldHandle {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly element: HTMLElement | null;
  focus(): void;
  setSelectionRange(start: number, end?: number): void;
}

interface MessageFieldProps extends Pick<AriaAttributes, 'aria-autocomplete' | 'aria-controls' | 'aria-activedescendant' | 'aria-invalid' | 'aria-describedby'> {
  ref?: Ref<MessageFieldHandle>;
  value: string;
  /** after every change of the text; `typed` is what was just typed at the caret, null for a paste, an undo or anything else */
  onChange: (value: string, caret: number, typed: string | null) => void;
  /** the caret moved without the text changing */
  onSelect?: (value: string, caret: number) => void;
  /** before the editor acts on a key: preventDefault() keeps it from doing so */
  onKeyDown?: (event: KeyboardEvent) => void;
  /** preventDefault() keeps the editor from pasting */
  onPaste?: (event: ClipboardEvent) => void;
  /** which server emoji a `:name:` stands for, if any */
  resolveCustomEmoji: ResolveCustomEmoji;
  placeholder?: string;
  'aria-label': string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** The message box, Discord-style: plain text whose emojis (Unicode, as
 * Twemoji, and server emojis) are drawn as pictures while typing. It reads and
 * writes the same text a textarea did, `:name:` for a server emoji, so drafts,
 * suggestions and sending work on text as before. Built on Lexical. */
export function MessageField(props: MessageFieldProps) {
  return (
    <LexicalComposer
      initialConfig={{
        namespace: 'message-field',
        nodes: [TwemojiNode, CustomEmojiNode],
        editable: !props.disabled,
        editorState: () => $setFieldText(props.value),
        onError: (error) => { throw error; },
      }}
    >
      <PlainTextPlugin
        contentEditable={(
          <ContentEditable
            aria-label={props['aria-label']}
            aria-multiline
            aria-autocomplete={props['aria-autocomplete']}
            aria-controls={props['aria-controls']}
            aria-activedescendant={props['aria-activedescendant']}
            aria-invalid={props['aria-invalid']}
            aria-describedby={props['aria-describedby']}
            aria-disabled={props.disabled || undefined}
            spellCheck
            className={cn('whitespace-pre-wrap break-words outline-none', props.className)}
          />
        )}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <FieldBridge {...props} />
    </LexicalComposer>
  );
}

function FieldBridge({ ref, value, onChange, onSelect, onKeyDown, onPaste, resolveCustomEmoji, placeholder, disabled, autoFocus }: MessageFieldProps) {
  const [editor] = useLexicalComposerContext();
  // the text as last reported or set: a value prop equal to it is no news
  const textRef = useRef(value);
  const caretRef = useRef(value.length);
  const handlers = useRef({ onChange, onSelect, onKeyDown, onPaste });
  const resolveRef = useRef(resolveCustomEmoji);
  // the latest callbacks, for listeners registered once
  useLayoutEffect(() => {
    handlers.current = { onChange, onSelect, onKeyDown, onPaste };
    resolveRef.current = resolveCustomEmoji;
  });

  useImperativeHandle(ref, () => ({
    get value() { return textRef.current; },
    get selectionStart() { return editor.getEditorState().read(() => $fieldSelection().start); },
    get selectionEnd() { return editor.getEditorState().read(() => $fieldSelection().end); },
    get element() { return editor.getRootElement(); },
    focus() { editor.focus(undefined, { defaultSelection: 'rootEnd' }); },
    setSelectionRange(start: number) {
      editor.update(() => $setFieldCaret(start), { discrete: true });
      editor.getRootElement()?.focus({ preventScroll: true });
    },
  }), [editor]);

  useEffect(() => mergeRegister(
    editor.registerNodeTransform(TextNode, (node) => $convertEmojis(node, (name, nth) => resolveRef.current(name, nth))),
    editor.registerUpdateListener(({ editorState, tags }) => {
      const { text, caret } = editorState.read(() => ({ text: $fieldText(), caret: $fieldSelection().start }));
      const previous = textRef.current;
      const previousCaret = caretRef.current;
      textRef.current = text;
      caretRef.current = caret;
      // a text set from outside was stored as `previous` before it was applied,
      // so only what the person did (even batched with it) reads as a change
      if (text !== previous) handlers.current.onChange(text, caret, tags.has('paste') || tags.has('historic') ? null : typedAt(previous, text, caret));
      else if (caret !== previousCaret) handlers.current.onSelect?.(text, caret);
    }),
    editor.registerCommand(KEY_DOWN_COMMAND, (event) => {
      handlers.current.onKeyDown?.(event);
      return event.defaultPrevented;
    }, COMMAND_PRIORITY_CRITICAL),
    editor.registerCommand(PASTE_COMMAND, (event) => {
      // a paste, not a drop or a typed shortcut that Lexical routes here too
      if (!('clipboardData' in event)) return false;
      handlers.current.onPaste?.(event as ClipboardEvent);
      return event.defaultPrevented;
    }, COMMAND_PRIORITY_CRITICAL),
  ), [editor]);

  // a text set from outside (a pick from a list, a sent message, another draft)
  useLayoutEffect(() => {
    if (value === textRef.current) return;
    textRef.current = value;
    caretRef.current = value.length;
    editor.update(() => $setFieldText(value), { discrete: true });
  }, [editor, value]);

  // a server emoji list that arrives later turns the `:name:`s already there into pictures
  useEffect(() => {
    editor.update(() => { for (const node of $getRoot().getAllTextNodes()) if (node.getType() === 'text') node.markDirty(); });
  }, [editor, resolveCustomEmoji]);

  useEffect(() => { editor.setEditable(!disabled); }, [editor, disabled]);

  // a placeholder attribute, as a textarea had: what assistive tech and tests find the box by
  useEffect(() => editor.registerRootListener((root) => {
    if (!root) return;
    if (placeholder) {
      root.setAttribute('aria-placeholder', placeholder);
      root.setAttribute('placeholder', placeholder);
    } else {
      root.removeAttribute('aria-placeholder');
      root.removeAttribute('placeholder');
    }
  }), [editor, placeholder]);

  useEffect(() => {
    if (autoFocus) editor.focus(undefined, { defaultSelection: 'rootEnd' });
  }, [editor, autoFocus]);

  return null;
}

/** What was inserted at the caret, when the change is only that. */
function typedAt(before: string, after: string, caret: number): string | null {
  const added = after.length - before.length;
  if (added <= 0 || caret < added) return null;
  const from = caret - added;
  return after.slice(0, from) === before.slice(0, from) && after.slice(caret) === before.slice(from) ? after.slice(from, caret) : null;
}

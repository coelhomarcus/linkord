import { act, fireEvent } from '@testing-library/react';
import { $getSelection, $isRangeSelection, getNearestEditorFromDOMNode, type LexicalEditor } from 'lexical';
import { $fieldText, $setFieldText } from '@/features/chat/messageField/fieldText';

// jsdom has no real `beforeinput`, so typing reaches the message field (a
// Lexical editor) through the editor itself, the way a browser's input would,
// and named keys arrive as the keydown events Lexical and the composer act on.

function editorOf(field: HTMLElement): LexicalEditor {
  const editor = getNearestEditorFromDOMNode(field);
  if (!editor) throw new Error('not a message field');
  return editor;
}

/** Text and `{Key}`s, like user-event's type(): "oi :lau{ArrowDown}{Enter}",
 * "linha 1{Shift>}{Enter}{/Shift}linha 2". */
export async function typeInField(field: HTMLElement, input: string): Promise<void> {
  const editor = editorOf(field);
  field.focus();
  let shiftKey = false;
  for (const [, key, char] of input.matchAll(/\{(\/?[A-Za-z]+>?)\}|([\s\S])/gu)) {
    if (key === 'Shift>') { shiftKey = true; continue; }
    if (key === '/Shift') { shiftKey = false; continue; }
    await act(async () => {
      if (key) {
        fireEvent.keyDown(field, { key, shiftKey });
        return;
      }
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection)) selection.insertText(char!);
      }, { discrete: true });
    });
  }
}

/** Replaces the whole text, like a change event on a textarea. */
export async function setFieldText(field: HTMLElement, text: string): Promise<void> {
  const editor = editorOf(field);
  await act(async () => { editor.update(() => $setFieldText(text), { discrete: true }); });
}

/** Shift+Enter: a new line instead of sending. */
export async function pressShiftEnter(field: HTMLElement): Promise<void> {
  await act(async () => { fireEvent.keyDown(field, { key: 'Enter', shiftKey: true }); });
}

/** What the field holds, as text (what a textarea's value was). */
export function fieldValue(field: HTMLElement): string {
  return editorOf(field).getEditorState().read(() => $fieldText());
}

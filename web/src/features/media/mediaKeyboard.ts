import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

export type MediaKeyAction =
  | { type: 'togglePlay' }
  | { type: 'seekBy'; seconds: number }
  | { type: 'volumeBy'; step: number }
  | { type: 'toggleMute' }
  | { type: 'toggleExpanded' }
  | { type: 'seekToFraction'; fraction: number }
  /** the key is the player's, but a held toggle must not flip it back and forth */
  | { type: 'none' };

/** For `aria-keyshortcuts` on the player. */
export const MEDIA_KEY_SHORTCUTS = 'Space K J L ArrowLeft ArrowRight ArrowUp ArrowDown M F 0 1 2 3 4 5 6 7 8 9 Home End';

const JUMP_SECONDS = 10;
const ARROW_SECONDS = 5;
const VOLUME_STEP = 0.1;

// The thumb Base UI focuses is an <input type="range"> inside the slider.
const SLIDER = '[role="slider"], input[type="range"]';
const BUTTON = 'button, [role="button"], a[href], [role="menuitem"], [role="menuitemradio"]';
const FIELD = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]';
const SLIDER_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
const BUTTON_KEYS = new Set([' ', 'Enter']);

type KeyLike = Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'metaKey' | 'altKey' | 'target'>;

/** A focused control inside the player keeps the keys it already answers to:
 * a slider its arrows, a button its Space and Enter, a field everything. */
function ownedByFocusedControl(key: string, target: Element, container: HTMLElement): boolean {
  if (target === container) return false;
  if (target.closest(SLIDER)) return SLIDER_KEYS.has(key);
  if (target.closest(FIELD)) return true;
  if (target.closest(BUTTON)) return BUTTON_KEYS.has(key);
  return false;
}

function toggle(event: KeyLike, action: MediaKeyAction): MediaKeyAction {
  return event.repeat ? { type: 'none' } : action;
}

/** What a key pressed inside the player does, the way video sites answer
 * them, or null when the key is not the player's. */
export function mediaKeyAction(event: KeyLike, container: HTMLElement): MediaKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const target = event.target;
  // a menu the player opened lives in a portal: its keys are its own
  if (!(target instanceof Element) || !container.contains(target)) return null;
  const { key } = event;
  if (ownedByFocusedControl(key, target, container)) return null;

  switch (key) {
    case ' ':
    case 'k':
    case 'K':
      return toggle(event, { type: 'togglePlay' });
    case 'j':
    case 'J':
      return { type: 'seekBy', seconds: -JUMP_SECONDS };
    case 'l':
    case 'L':
      return { type: 'seekBy', seconds: JUMP_SECONDS };
    case 'ArrowLeft':
      return { type: 'seekBy', seconds: -ARROW_SECONDS };
    case 'ArrowRight':
      return { type: 'seekBy', seconds: ARROW_SECONDS };
    case 'ArrowUp':
      return { type: 'volumeBy', step: VOLUME_STEP };
    case 'ArrowDown':
      return { type: 'volumeBy', step: -VOLUME_STEP };
    case 'm':
    case 'M':
      return toggle(event, { type: 'toggleMute' });
    case 'f':
    case 'F':
      return toggle(event, { type: 'toggleExpanded' });
    case 'Home':
      return { type: 'seekToFraction', fraction: 0 };
    case 'End':
      return { type: 'seekToFraction', fraction: 1 };
    default:
      if (/^[0-9]$/.test(key)) return { type: 'seekToFraction', fraction: Number(key) / 10 };
      return null;
  }
}

/** The player's onKeyDown: runs the action and keeps the key from also
 * scrolling the chat (Space, arrows) or reaching the dialog around it. */
export function handleMediaKeyDown(event: ReactKeyboardEvent<HTMLElement>, run: (action: MediaKeyAction) => void): void {
  const action = mediaKeyAction(event.nativeEvent, event.currentTarget);
  if (!action) return;
  event.preventDefault();
  event.stopPropagation();
  run(action);
}

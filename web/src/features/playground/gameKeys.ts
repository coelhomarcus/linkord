// What a key does inside the playground, decided in one place so the game, not
// the browser, answers it. The stage (PlaygroundStage) asks this for every key
// pressed while the game has the keyboard and acts on the answer; walking keys
// themselves are the controls' (engine/controls.ts), which this lets through.
//
// The block game's keys: Esc and Tab open the menu, T, Enter and / open the
// chat, F1 hides the HUD, F5 changes the camera (V too), F11 is fullscreen.
// Anything else the browser would act on is swallowed: reload (F5, Ctrl+R),
// find (F3, /, '), the address bar (F6), page zoom, saving, printing, Alt's
// menu bar... What no page can stop (Ctrl+W, T, N outside fullscreen) is held
// by the Keyboard Lock API while the game is fullscreen (KEYBOARD_LOCK_KEYS).

export type GameKeyAction =
  /** open the menu, or close it from Tab */
  | 'menu'
  | 'chat'
  | 'camera'
  | 'hud'
  | 'fullscreen'
  /** nothing happens, and the browser does not act on it either */
  | 'swallow'
  /** not the game's: the controls, a focused field or the browser's own */
  | null;

export interface GameKey {
  code: string;
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

export interface GameKeyState {
  menuOpen: boolean;
  chatOpen: boolean;
  /** the key goes into a text field (the chat line, a menu field) */
  typing: boolean;
  /** a button or link has focus: Enter and Space press it */
  onControl: boolean;
}

/** Keys the Keyboard Lock API takes from the browser while the game is fullscreen (Chromium only). */
export const KEYBOARD_LOCK_KEYS = [
  'Escape', 'Tab', 'KeyW', 'KeyT', 'KeyN', 'KeyQ', 'KeyR', 'F1', 'F3', 'F5', 'F6', 'F11',
  'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight',
];

/** The controls' keys: with Ctrl held they are the sprint, not a shortcut. */
const WALKING = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight']);

/** Kept for the browser and the user: copy and paste, and the developer tools. */
const BROWSER_KEPT = new Set(['KeyC', 'KeyV', 'KeyX', 'KeyA', 'KeyZ']);

export function gameKeyAction(key: GameKey, state: GameKeyState): GameKeyAction {
  const { code } = key;
  if (code === 'F12') return null;
  if (code === 'F11') return key.repeat ? 'swallow' : 'fullscreen';
  if (/^F\d+$/.test(code)) {
    if (key.repeat || state.typing || state.menuOpen) return 'swallow';
    if (code === 'F1') return 'hud';
    if (code === 'F5') return 'camera';
    return 'swallow';
  }

  // Ctrl and Cmd shortcuts: the page's own reload, save, print, find, zoom... never fire mid-game.
  // Ctrl with a walking key is the sprint (the controls see it); copy and paste stay in fields.
  if (key.ctrlKey || key.metaKey) {
    if (state.typing && BROWSER_KEPT.has(code)) return null;
    if (key.ctrlKey && !key.metaKey && !key.altKey && WALKING.has(code) && !state.typing) return null;
    return /^(Key[A-Z]|Digit\d|Equal|Minus|NumpadAdd|NumpadSubtract|Numpad0|Comma|Period|Slash|BracketLeft|BracketRight|Backquote)$/.test(code) ? 'swallow' : null;
  }

  if (code === 'Tab') return key.repeat || state.chatOpen ? 'swallow' : 'menu';
  if (code === 'Escape') {
    // the menu and the chat line answer Esc themselves (back a page, close)
    if (state.menuOpen || state.chatOpen) return null;
    return key.repeat ? 'swallow' : 'menu';
  }
  if (state.typing) return null;
  if (state.menuOpen || state.chatOpen) return null;

  if (code === 'AltLeft' || code === 'AltRight') return 'swallow';
  if (key.altKey) return 'swallow';
  if (code === 'Enter' && state.onControl) return null;
  if (code === 'KeyT' || code === 'Enter' || code === 'NumpadEnter' || code === 'Slash') return key.repeat ? 'swallow' : 'chat';
  if (code === 'KeyV') return key.repeat ? 'swallow' : 'camera';
  // Firefox's quick find, and the browser going back
  if (code === 'Quote' || code === 'Backspace') return 'swallow';
  return null;
}


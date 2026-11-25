import { desktopApp } from '@/shared/desktop';

// Showing an element fullscreen: the call stage or one tile.
//
// In a browser it is the Fullscreen API. In the desktop app it is the window's fullscreen instead,
// with the element filling the window ([data-window-fullscreen] in styles/index.css): Chromium leaves
// an element's fullscreen on Esc, and inside Electron no Keyboard Lock keeps Esc for the page, so
// every Esc that closes a menu or dialog on the stage would also leave fullscreen. Esc leaves
// the window's fullscreen only when nothing on the page used it; F11 and the page's own buttons
// leave it too, and so does the element leaving the page, as with the Fullscreen API.

const ATTRIBUTE = 'data-window-fullscreen';

/** the element filling the fullscreen window, in the desktop app */
let windowElement: HTMLElement | null = null;
/** the window's fullscreen as last reported; leaving it (F11) lets go of the element */
let windowFull = false;
/** the window was already fullscreen (F11) when the element took it: it stays so after */
let windowWasFull = false;
let watchingWindow = false;
let elementGone: MutationObserver | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

/** The element shown fullscreen, if any: menus and dialogs portal into it to stay visible. */
export function fullscreenElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return (document.fullscreenElement as HTMLElement | null) ?? windowElement;
}

export function subscribeFullscreen(listener: () => void): () => void {
  listeners.add(listener);
  document.addEventListener('fullscreenchange', listener);
  return () => {
    listeners.delete(listener);
    document.removeEventListener('fullscreenchange', listener);
  };
}

export async function enterFullscreen(element: HTMLElement): Promise<void> {
  const setFullScreen = desktopApp()?.setFullScreen;
  if (setFullScreen) {
    await enterWindowFullscreen(element, setFullScreen);
    return;
  }
  if (!element.requestFullscreen || document.fullscreenEnabled === false) return;
  await element.requestFullscreen().catch(() => {});
}

export async function exitFullscreen(): Promise<void> {
  if (windowElement) {
    const keepWindow = windowWasFull;
    letGo();
    if (!keepWindow) await desktopApp()?.setFullScreen?.(false).catch(() => {});
    return;
  }
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
}

async function enterWindowFullscreen(element: HTMLElement, setFullScreen: (on: boolean) => Promise<void>) {
  const controls = desktopApp()?.windowControls;
  if (!watchingWindow && controls) {
    watchingWindow = true;
    controls.onStateChange((state) => {
      if (windowFull && !state.fullScreen) letGo();
      windowFull = state.fullScreen;
    });
  }
  const state = await controls?.getState().catch(() => null);
  if (state) windowFull = state.fullScreen;
  // from the stage to one of its tiles, the window was put in fullscreen by the stage
  if (!windowElement) windowWasFull = windowFull;
  show(element);
  await setFullScreen(true).catch(() => {});
}

function show(element: HTMLElement) {
  windowElement?.removeAttribute(ATTRIBUTE);
  windowElement = element;
  element.setAttribute(ATTRIBUTE, '');
  window.addEventListener('keydown', onKeyDown);
  elementGone ??= new MutationObserver(() => {
    if (windowElement && !windowElement.isConnected) void exitFullscreen();
  });
  elementGone.observe(document.body, { childList: true, subtree: true });
  notify();
}

function letGo() {
  if (!windowElement) return;
  windowElement.removeAttribute(ATTRIBUTE);
  windowElement = null;
  window.removeEventListener('keydown', onKeyDown);
  elementGone?.disconnect();
  notify();
}

// In the bubble phase on the window, after the page's own handlers: a menu or dialog Esc closes
// marks the key as used (preventDefault), and fullscreen stays
function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.repeat) return;
  event.preventDefault();
  void exitFullscreen();
}

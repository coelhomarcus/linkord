import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopWindowState } from '@/shared/desktop';
import { enterFullscreen, exitFullscreen, fullscreenElement, subscribeFullscreen } from '@/shared/lib/fullscreen';

// The store watches the window once, for the whole page: one fake window serves every test
let windowState: DesktopWindowState = { maximized: false, fullScreen: false, focused: true };
let stateListener: ((state: DesktopWindowState) => void) | null = null;
const setFullScreen = vi.fn(async (on: boolean) => { reportWindow(on); });

function reportWindow(fullScreen: boolean) {
  windowState = { ...windowState, fullScreen };
  stateListener?.(windowState);
}

function installDesktop() {
  window.linkordDesktop = {
    platform: 'win32',
    version: '0.9.0',
    setFullScreen,
    windowControls: {
      style: 'windows',
      minimize: async () => {},
      toggleMaximize: async () => {},
      close: async () => {},
      getState: async () => windowState,
      onStateChange: (callback) => {
        stateListener = callback;
        return () => {};
      },
    },
  };
}

function pressEscape(handledByPage = false) {
  const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
  if (handledByPage) event.preventDefault();
  document.body.dispatchEvent(event);
}

function stage() {
  const element = document.createElement('main');
  document.body.append(element);
  return element;
}

describe('fullscreen in the desktop app', () => {
  beforeEach(() => {
    installDesktop();
    windowState = { maximized: false, fullScreen: false, focused: true };
    setFullScreen.mockClear();
  });

  afterEach(async () => {
    await exitFullscreen();
    document.body.replaceChildren();
    delete window.linkordDesktop;
  });

  it('fills a fullscreen window with the element instead of the Fullscreen API', async () => {
    const element = stage();
    element.requestFullscreen = vi.fn(async () => {});
    const changed = vi.fn();
    const unsubscribe = subscribeFullscreen(changed);

    await enterFullscreen(element);

    expect(setFullScreen).toHaveBeenCalledWith(true);
    expect(element.requestFullscreen).not.toHaveBeenCalled();
    expect(element.hasAttribute('data-window-fullscreen')).toBe(true);
    expect(fullscreenElement()).toBe(element);
    expect(changed).toHaveBeenCalled();
    unsubscribe();
  });

  it('leaves on an Esc nothing on the page used', async () => {
    const element = stage();
    await enterFullscreen(element);

    pressEscape();

    expect(fullscreenElement()).toBeNull();
    expect(element.hasAttribute('data-window-fullscreen')).toBe(false);
    expect(setFullScreen).toHaveBeenLastCalledWith(false);
  });

  it('stays when the page used the Esc (a menu closing, a game screen)', async () => {
    const element = stage();
    await enterFullscreen(element);

    pressEscape(true);

    expect(fullscreenElement()).toBe(element);
    expect(setFullScreen).not.toHaveBeenCalledWith(false);
  });

  it('lets go of the element when the window leaves fullscreen by itself (F11)', async () => {
    const element = stage();
    await enterFullscreen(element);

    reportWindow(false);

    expect(fullscreenElement()).toBeNull();
    expect(element.hasAttribute('data-window-fullscreen')).toBe(false);
  });

  it('a window already fullscreen before (F11) stays so when the element leaves', async () => {
    reportWindow(true);
    const element = stage();
    await enterFullscreen(element);

    await exitFullscreen();

    expect(fullscreenElement()).toBeNull();
    expect(setFullScreen).not.toHaveBeenCalledWith(false);
  });

  it('moves from the stage to one of its tiles without leaving the window\'s fullscreen', async () => {
    const element = stage();
    const tile = document.createElement('div');
    element.append(tile);
    await enterFullscreen(element);
    await enterFullscreen(tile);

    expect(fullscreenElement()).toBe(tile);
    expect(element.hasAttribute('data-window-fullscreen')).toBe(false);

    await exitFullscreen();
    expect(setFullScreen).toHaveBeenLastCalledWith(false);
  });

  it('leaves when the element leaves the page (the call ends)', async () => {
    const element = stage();
    await enterFullscreen(element);

    element.remove();
    await vi.waitFor(() => expect(fullscreenElement()).toBeNull());
    expect(setFullScreen).toHaveBeenLastCalledWith(false);
  });
});

describe('fullscreen in a browser', () => {
  afterEach(() => {
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  });

  it('uses the Fullscreen API, also in a desktop build without the window\'s fullscreen', async () => {
    window.linkordDesktop = { platform: 'win32', version: '0.8.0' };
    const element = stage();
    element.requestFullscreen = vi.fn(async () => {});

    await enterFullscreen(element);

    expect(element.requestFullscreen).toHaveBeenCalled();
    expect(element.hasAttribute('data-window-fullscreen')).toBe(false);
    delete window.linkordDesktop;
    element.remove();
  });

  it('leaves through the Fullscreen API', async () => {
    const element = document.createElement('div');
    Object.defineProperty(document, 'fullscreenElement', { value: element, configurable: true });
    document.exitFullscreen = vi.fn(async () => {});

    expect(fullscreenElement()).toBe(element);
    await exitFullscreen();

    expect(document.exitFullscreen).toHaveBeenCalled();
  });
});

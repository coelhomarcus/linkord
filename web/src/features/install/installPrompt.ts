import { useCallback, useSyncExternalStore } from 'react';

import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { iosStandalone, isIOSDevice } from '@/shared/lib/displayMode';
import { isDesktopApp } from '@/shared/desktop';

/** Chromium's install event; not part of lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** `prompt`: the browser hands us an install dialog to open. `ios`: no API
 * exists, the person has to use Share → Add to Home Screen. */
export type InstallMethod = 'prompt' | 'ios';

export function installMethod(input: { standalone: boolean; canPrompt: boolean; ios: boolean }): InstallMethod | null {
  if (input.standalone) return null;
  if (input.canPrompt) return 'prompt';
  return input.ios ? 'ios' : null;
}

interface CaptureState { prompt: BeforeInstallPromptEvent | null; installed: boolean }

let captured: CaptureState = { prompt: null, installed: false };
const listeners = new Set<() => void>();

function setCaptured(next: CaptureState) {
  captured = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The browser fires `beforeinstallprompt` once, often before any screen has
 * mounted, so it is caught at startup and held until someone asks for it.
 * Returns the function that stops listening. */
export function startInstallPromptCapture(): () => void {
  const onBeforeInstall = (event: Event) => {
    // keeps the browser's own mini-infobar away; we offer the install ourselves
    event.preventDefault();
    setCaptured({ ...captured, prompt: event as BeforeInstallPromptEvent });
  };
  const onInstalled = () => setCaptured({ prompt: null, installed: true });
  window.addEventListener('beforeinstallprompt', onBeforeInstall);
  window.addEventListener('appinstalled', onInstalled);
  return () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    window.removeEventListener('appinstalled', onInstalled);
    captured = { prompt: null, installed: false };
  };
}

export interface InstallState {
  /** How this device can install, or null when it can't or already has. */
  method: InstallMethod | null;
  /** The web app is installed: this page runs as it, or the browser just installed it. Never in the desktop app. */
  installed: boolean;
  /** Opens the browser's install dialog; resolves to whether the person accepted. */
  install: () => Promise<boolean>;
}

export function useInstall(): InstallState {
  const state = useSyncExternalStore(subscribe, () => captured);
  const displayModeStandalone = useMediaQuery('(display-mode: standalone)');
  const installed = (displayModeStandalone || iosStandalone() || state.installed) && !isDesktopApp();
  // the desktop app is the installed app; Electron never offers a web install anyway
  const standalone = installed || isDesktopApp();
  const method = installMethod({ standalone, canPrompt: state.prompt !== null, ios: isIOSDevice() });

  const install = useCallback(async () => {
    const prompt = captured.prompt;
    if (!prompt) return false;
    // the event is single-use, whatever the person answers
    setCaptured({ ...captured, prompt: null });
    try {
      await prompt.prompt();
      return (await prompt.userChoice).outcome === 'accepted';
    } catch {
      return false;
    }
  }, []);

  return { method, installed, install };
}

import { useCallback, useState, useSyncExternalStore } from 'react';

import { useMediaQuery } from '@/shared/hooks/useMediaQuery';
import { LOCAL_STORAGE_KEYS, localStorageStore } from '@/shared/lib/localStorage';
import { iosStandalone, isIOSDevice } from '@/shared/lib/displayMode';

/** Chromium's install event; not part of lib.dom. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Sessions (tabs opened) before the banner shows, so it never greets a new visitor. */
export const SESSIONS_BEFORE_BANNER = 3;

/** `prompt`: the browser hands us an install dialog to open. `ios`: no API
 * exists, the person has to use Share → Add to Home Screen. */
export type InstallMethod = 'prompt' | 'ios';

export function installMethod(input: { standalone: boolean; canPrompt: boolean; ios: boolean }): InstallMethod | null {
  if (input.standalone) return null;
  if (input.canPrompt) return 'prompt';
  return input.ios ? 'ios' : null;
}

export function shouldShowInstallBanner(input: { method: InstallMethod | null; dismissed: boolean; sessions: number; inCall: boolean }): boolean {
  return input.method !== null && !input.dismissed && !input.inCall && input.sessions >= SESSIONS_BEFORE_BANNER;
}

export function isDismissed(): boolean {
  return localStorageStore.get(LOCAL_STORAGE_KEYS.installBannerDismissed) === '1';
}

export function dismissInstallBanner(): void {
  localStorageStore.set(LOCAL_STORAGE_KEYS.installBannerDismissed, '1');
}

export function readInstallSessions(): number {
  const count = Number(localStorageStore.get(LOCAL_STORAGE_KEYS.installSessions));
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

const SESSION_COUNTED_KEY = 'ss-install-session-counted';
// only used when session storage is blocked, so a remount still stays in one session
let countedInMemory = false;

/** Counts this tab once: a reload or a remount stays in the same session.
 * Called at startup, so the count is settled before any screen reads it. */
export function recordInstallSession(): number {
  try {
    if (window.sessionStorage.getItem(SESSION_COUNTED_KEY) === '1') return readInstallSessions();
    window.sessionStorage.setItem(SESSION_COUNTED_KEY, '1');
  } catch {
    if (countedInMemory) return readInstallSessions();
    countedInMemory = true;
  }
  const next = readInstallSessions() + 1;
  localStorageStore.set(LOCAL_STORAGE_KEYS.installSessions, String(next));
  return next;
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
  /** Opens the browser's install dialog; resolves to whether the person accepted. */
  install: () => Promise<boolean>;
}

export function useInstall(): InstallState {
  const state = useSyncExternalStore(subscribe, () => captured);
  const displayModeStandalone = useMediaQuery('(display-mode: standalone)');
  const standalone = displayModeStandalone || iosStandalone() || state.installed;
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

  return { method, install };
}

export interface InstallBannerState {
  method: InstallMethod | null;
  visible: boolean;
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useInstallBanner(inCall: boolean): InstallBannerState {
  const { method, install } = useInstall();
  const [dismissed, setDismissed] = useState(isDismissed);
  const [sessions] = useState(readInstallSessions);

  const dismiss = useCallback(() => {
    dismissInstallBanner();
    setDismissed(true);
  }, []);

  const installFromBanner = useCallback(async () => {
    // declining the browser's dialog is an answer too: do not ask again
    if (!(await install())) dismiss();
  }, [install, dismiss]);

  return {
    method,
    visible: shouldShowInstallBanner({ method, dismissed, sessions, inCall }),
    install: installFromBanner,
    dismiss,
  };
}

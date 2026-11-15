import { useSyncExternalStore } from 'react';

// What the desktop app's preload exposes (desktop/src/preload/index.cts).
// Electron shows no picker of its own for getDisplayMedia: on 'app' the page
// lists the sources, the person picks one here, and the desktop app grants
// that one when the share then calls getDisplayMedia. On 'system' the OS
// shows its picker and the page just calls getDisplayMedia.

export interface DesktopSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  /** data: URL, or null when the system gave no preview */
  thumbnail: string | null;
  appIcon: string | null;
}

export interface DesktopScreenShare {
  picker: 'system' | 'app';
  /** whether the share can carry the computer's sound (Windows) */
  systemAudio: boolean;
  listSources: () => Promise<DesktopSource[]>;
  select: (id: string, audio: boolean) => Promise<boolean>;
}

declare global {
  interface Window {
    linkordDesktop?: {
      platform: string;
      version: string;
      /** absent in desktop builds older than screen sharing */
      screenShare?: DesktopScreenShare;
    };
  }
}

export function desktopScreenShare(): DesktopScreenShare | null {
  return window.linkordDesktop?.screenShare ?? null;
}

export interface DesktopSourceChoice {
  id: string;
  audio: boolean;
}

export interface DesktopSourceRequest {
  /** a new number for every request, so the picker starts over */
  id: number;
  sources: DesktopSource[];
  systemAudio: boolean;
}

let nextRequestId = 1;
let pending: (DesktopSourceRequest & { resolve: (choice: DesktopSourceChoice | null) => void }) | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The request DesktopSourcePicker shows, or null. */
export function useDesktopSourceRequest(): DesktopSourceRequest | null {
  return useSyncExternalStore(subscribe, () => pending);
}

/** The picker's answer: a source, or null when the person closed it. */
export function answerDesktopSource(choice: DesktopSourceChoice | null): void {
  const current = pending;
  if (!current) return;
  pending = null;
  notify();
  current.resolve(choice);
}

/**
 * Lists the screens and windows, waits for the person to pick one in
 * DesktopSourcePicker and hands the pick to the desktop app. False when they
 * cancelled. Throws when the desktop app could not list or take the source.
 */
export async function chooseDesktopSource(share: DesktopScreenShare): Promise<boolean> {
  const sources = await share.listSources();
  // A second share started while one picker is open replaces it
  answerDesktopSource(null);
  const choice = await new Promise<DesktopSourceChoice | null>((resolve) => {
    pending = { id: nextRequestId++, sources, systemAudio: share.systemAudio, resolve };
    notify();
  });
  if (!choice) return false;
  if (!(await share.select(choice.id, choice.audio))) throw new Error('the desktop app did not accept the source');
  return true;
}

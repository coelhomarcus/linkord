import { useSyncExternalStore } from 'react';
import { desktopApp } from '@/shared/desktop';
import type { DesktopScreenShare, DesktopSource } from '@/shared/desktop';

// Electron shows no picker of its own for getDisplayMedia. Where the desktop
// app has no system picker either ('app'), the page lists the sources, the
// person picks one in DesktopSourcePicker, and the desktop app grants that one
// when the share then calls getDisplayMedia.

export function desktopScreenShare(): DesktopScreenShare | null {
  return desktopApp()?.screenShare ?? null;
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

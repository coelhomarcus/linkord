// How a screen share is chosen and granted. Chromium in a browser shows its
// own picker for getDisplayMedia; Electron shows none, so the app either hands
// the request to the system's picker or lets the page pick from the sources it
// lists, remembers the pick, and grants exactly that source when the page then
// calls getDisplayMedia.

/** 'system': the OS shows the picker. 'app': the page shows its own, fed by listSources. */
export type SharePicker = 'system' | 'app';

export function sharePicker(input: {
  platform: NodeJS.Platform;
  systemVersion: string;
  env: Readonly<Record<string, string | undefined>>;
}): SharePicker {
  if (input.env.LINKORD_SYSTEM_PICKER === '0') return 'app';
  // macOS 15's picker (ScreenCaptureKit) also needs no Screen Recording
  // permission: the person grants each share by picking it, which an unsigned
  // build would otherwise lose with every update
  if (input.platform === 'darwin') return Number.parseInt(input.systemVersion, 10) >= 15 ? 'system' : 'app';
  // On Wayland only the desktop portal may capture, and it shows its own picker
  if (input.platform === 'linux') return input.env.XDG_SESSION_TYPE === 'wayland' ? 'system' : 'app';
  return 'app';
}

/** Electron can mix the system's sound into a share only on Windows. */
export function capturesSystemAudio(platform: NodeJS.Platform): boolean {
  return platform === 'win32';
}

export type SourceKind = 'screen' | 'window';

export function sourceKind(id: string): SourceKind {
  return id.startsWith('screen:') ? 'screen' : 'window';
}

export interface ListedSource {
  id: string;
  name: string;
}

export interface Selection extends ListedSource {
  audio: boolean;
  at: number;
}

// The page asks for the stream right after the pick; one left over from a
// cancelled attempt must not answer a later share the person did not pick for
export const SELECTION_TTL_MS = 60_000;

/** The sources each page was shown, and the one it picked, per page (webContents id). */
export class SourceSelections {
  #listed = new Map<number, Map<string, string>>();
  #chosen = new Map<number, Selection>();

  remember(pageId: number, sources: readonly ListedSource[]): void {
    this.#listed.set(pageId, new Map(sources.map((s) => [s.id, s.name])));
    this.#chosen.delete(pageId);
  }

  /** Only a source from the last listing can be picked, so the page cannot name one it was never shown. */
  choose(pageId: number, id: string, audio: boolean, now: number): boolean {
    const name = this.#listed.get(pageId)?.get(id);
    if (name === undefined) return false;
    this.#chosen.set(pageId, { id, name, audio, at: now });
    return true;
  }

  /** The pick, once: a second getDisplayMedia needs a new one. */
  take(pageId: number, now: number): Selection | null {
    const selection = this.#chosen.get(pageId) ?? null;
    this.#chosen.delete(pageId);
    if (!selection || now - selection.at > SELECTION_TTL_MS) return null;
    return selection;
  }

  forget(pageId: number): void {
    this.#listed.delete(pageId);
    this.#chosen.delete(pageId);
  }
}

export function streamsFor(selection: Selection, request: { audioRequested: boolean; platform: NodeJS.Platform }): {
  video: ListedSource;
  audio?: 'loopback';
} {
  const video = { id: selection.id, name: selection.name };
  const withAudio = selection.audio && request.audioRequested && capturesSystemAudio(request.platform);
  return withAudio ? { video, audio: 'loopback' } : { video };
}

// How a screen share is chosen and granted. Chromium in a browser shows its
// own picker for getDisplayMedia; Electron shows none, so the page picks from
// the sources the app lists, the app remembers the pick, and grants exactly
// that source when the page then calls getDisplayMedia.

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

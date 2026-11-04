import { useSyncExternalStore } from 'react';

/** The last still the server answered for each streaming connection. Kept
 * outside the room reducer: it is a hover-only picture, nothing else reacts
 * to it, and it should not re-render the room on every arrival. Never
 * persisted; the next hover asks again. */
export interface StreamPreview {
  /** null: the server had nothing to show */
  image: string | null;
  receivedAt: number;
}

const previews = new Map<string, StreamPreview>();
const listeners = new Set<() => void>();

export const streamPreviewStore = {
  get: (participantId: string) => previews.get(participantId),
  set(participantId: string, image: string | null, receivedAt = Date.now()) {
    previews.set(participantId, { image, receivedAt });
    for (const listener of listeners) listener();
  },
  clear() {
    previews.clear();
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export function useStreamPreview(participantId: string): StreamPreview | undefined {
  return useSyncExternalStore(streamPreviewStore.subscribe, () => streamPreviewStore.get(participantId));
}

import { useCallback, useEffect, useSyncExternalStore } from 'react';

// One embedded player (a YouTube or Twitch iframe) at a time: starting one
// takes the place of the one before, which goes back to its thumbnail, so two
// videos never talk over each other. The iframe is unmounted rather than
// paused: the page cannot reach into a third-party player (no script API under
// our Content-Security-Policy, see youtubeEmbedUrl.ts).

let activeId: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null) {
  if (next === activeId) return;
  activeId = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether the player `id` is the one playing, and a way to start it. */
export function useActiveEmbed(id: string): { active: boolean; play: () => void; stop: () => void } {
  const active = useSyncExternalStore(subscribe, () => activeId === id, () => false);
  const play = useCallback(() => set(id), [id]);
  const stop = useCallback(() => { if (activeId === id) set(null); }, [id]);
  // a player scrolled out of the virtualized list, or removed, gives its turn up
  useEffect(() => () => { if (activeId === id) set(null); }, [id]);
  return { active, play, stop };
}

/** For tests: back to no player. */
export function __resetActiveEmbedForTests(): void {
  set(null);
}

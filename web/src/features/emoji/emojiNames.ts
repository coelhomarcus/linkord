import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch } from '@/shared/api/api';
import { useKnownCustomEmoji } from './myEmojis';

// The name of a server emoji seen as a reaction, where (unlike message text)
// only its id travels. The account's own emojis are already known; the rest
// are asked for together (GET /api/emojis/meta) and kept for the session.

const names = new Map<string, string | null>();
const queued = new Set<string>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let scheduled = false;

function flush(): void {
  scheduled = false;
  const ids = [...queued].slice(0, 50);
  for (const id of ids) { queued.delete(id); inFlight.add(id); }
  if (queued.size) schedule();
  apiFetch<{ emojis: { id: string; name: string }[] }>(`/api/emojis/meta?ids=${ids.join(',')}`)
    .then(({ emojis }) => {
      for (const id of ids) names.set(id, null);
      for (const emoji of emojis) names.set(emoji.id, emoji.name);
    })
    // forgotten, so a later render asks again
    .catch(() => { for (const id of ids) names.delete(id); })
    .finally(() => {
      for (const id of ids) inFlight.delete(id);
      for (const listener of listeners) listener();
    });
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(flush);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The emoji's name; undefined while unknown, null once known to be gone. */
export function useCustomEmojiName(emojiId: string): string | null | undefined {
  const known = useKnownCustomEmoji(emojiId);
  const fetched = useSyncExternalStore(subscribe, () => names.get(emojiId));
  useEffect(() => {
    if (known || names.has(emojiId) || queued.has(emojiId) || inFlight.has(emojiId)) return;
    queued.add(emojiId);
    schedule();
  }, [known, emojiId]);
  return known?.name ?? fetched;
}

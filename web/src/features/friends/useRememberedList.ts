import { useEffect, useState } from 'react';
import { useCursorList } from '@/shared/hooks/useCursorList';
import type { ListSnapshot } from '@/shared/hooks/useCursorList';
import { useRoom } from '@/state/RoomContext';

// In memory only, and keyed by account, so a second login in the same tab never
// sees the first one's rows. A restored window is re-read at once (see
// useCursorList's `restore`): it only spares the blank screen, it's never trusted.
const MAX_ENTRIES = 12;
const windows = new Map<string, ListSnapshot<unknown>>();

function remember(key: string, snapshot: ListSnapshot<unknown>) {
  windows.delete(key);
  windows.set(key, snapshot);
  while (windows.size > MAX_ENTRIES) windows.delete(windows.keys().next().value as string);
}

/** useCursorList for the friends views: switching back to a view shows the rows
 * it had at once, instead of blanking and loading them again. `restored` says
 * the list started from those rows, so they shouldn't play an entrance. */
export function useRememberedList<T>(
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>,
  identity: string,
  options: { revision?: string | number; getKey: (item: T) => string },
) {
  const { state } = useRoom();
  const key = `${state.me.userId ?? ''}|${identity}`;
  // read once, as the view opens
  const [seed] = useState(() => windows.get(key) as ListSnapshot<T> | undefined);
  const [firstIdentity] = useState(identity);
  const list = useCursorList(fetchPage, identity, { ...options, restore: seed ?? null });
  const { status, items, snapshot } = list;

  useEffect(() => {
    if (status === 'ready') remember(key, snapshot());
  }, [key, status, items, snapshot]);

  // only the view as it was opened came from memory; a new search loads for real
  return { ...list, restored: !!seed && identity === firstIdentity };
}

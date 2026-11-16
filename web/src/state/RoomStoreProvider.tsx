import { useLayoutEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoomStore, RoomStoreContext } from './RoomContext';
import type { RoomContextValue } from './RoomContext';

/** Publishes `value` to the readers below; RoomProvider wraps the app in it, tests use it with a fake value. */
export function RoomStoreProvider({ value, children }: { value: RoomContextValue; children: ReactNode }) {
  const [store] = useState(() => createRoomStore(value));
  // after commit, so a reader never sees a value from a render React threw away;
  // useSyncExternalStore re-renders, before paint, whoever rendered with the older one
  useLayoutEffect(() => { store.set(value); }, [store, value]);
  return <RoomStoreContext.Provider value={store}>{children}</RoomStoreContext.Provider>;
}

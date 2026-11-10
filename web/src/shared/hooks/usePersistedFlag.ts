import { useCallback, useState } from 'react';
import { localStorageStore } from '@/shared/lib/localStorage';
import type { LocalStorageKey } from '@/shared/lib/localStorage';

function read(key: LocalStorageKey, fallback: boolean): boolean {
  const stored = localStorageStore.get(key);
  return stored === '1' ? true : stored === '0' ? false : fallback;
}

/** A yes/no preference kept in localStorage. When `key` changes (a panel
 * remembered per layout, crossing a breakpoint) the value of the new key is
 * read, so each key keeps its own state. */
export function usePersistedFlag(key: LocalStorageKey, fallback: boolean): [boolean, (value: boolean) => void] {
  const [state, setState] = useState(() => ({ key, value: read(key, fallback) }));
  const current = state.key === key ? state : { key, value: read(key, fallback) };
  if (current !== state) setState(current);
  const set = useCallback((value: boolean) => {
    localStorageStore.set(key, value ? '1' : '0');
    setState({ key, value });
  }, [key]);
  return [current.value, set];
}

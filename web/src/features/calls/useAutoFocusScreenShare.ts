import { useEffect, useRef } from 'react';
import type { TileDescriptor } from './tileTypes';

/** Focus a newly started screen share unless the viewer has chosen a focus manually. */
export function useAutoFocusScreenShare(
  descriptors: TileDescriptor[],
  focusOrigin: 'manual' | 'automatic' | 'capacity' | null,
  onAutoFocus: (key: string) => void,
): void {
  const seenScreenKeysRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentScreenKeys = new Set(descriptors.filter((d) => d.kind === 'screen').map((d) => d.key));
    const seen = seenScreenKeysRef.current;
    seenScreenKeysRef.current = currentScreenKeys;
    if (!seen) return;
    if (focusOrigin === 'manual') return;

    for (const key of currentScreenKeys) {
      if (!seen.has(key)) { onAutoFocus(key); return; }
    }
  }, [descriptors, focusOrigin, onAutoFocus]);
}

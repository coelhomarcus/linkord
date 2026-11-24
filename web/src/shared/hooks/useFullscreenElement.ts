import { useSyncExternalStore } from 'react';
import { fullscreenElement, subscribeFullscreen } from '@/shared/lib/fullscreen';

/** The element shown fullscreen right now, or null: the Fullscreen API's, or in the desktop app the
 * one filling the fullscreen window (shared/lib/fullscreen.ts). It follows Esc and F11 too, not just
 * this app's own calls. Menus and popovers portal into it (when set) instead of `document.body`,
 * which a fullscreen element would otherwise hide. */
export function useFullscreenElement(): HTMLElement | null {
  return useSyncExternalStore(subscribeFullscreen, fullscreenElement, () => null);
}

import { createContext, useCallback, useContext } from 'react';
import type { ViewerItem } from '@/features/media/viewer/viewerItem';

export interface MediaViewerApi {
  open: (items: ViewerItem[], index: number) => void;
}

export const MediaViewerContext = createContext<MediaViewerApi | null>(null);

/** Null outside a chat surface (e.g. a row rendered on its own in a test). */
export function useMediaViewer(): MediaViewerApi | null {
  return useContext(MediaViewerContext);
}

/** The message a picture, card or player is drawn in (MessageMediaScope): opening any of its media
 * opens the whole message's set, at that one. */
export interface MessageMediaScopeApi {
  open: (key: string, fallback: ViewerItem[], fallbackIndex: number) => void;
}

export const MessageMediaScopeContext = createContext<MessageMediaScopeApi | null>(null);

/** How a media control opens the viewer: inside a message, on the message's whole set; elsewhere
 * (a card on its own, the media panel's grid) on what it was given. */
export function useOpenMedia(): (items: ViewerItem[], index: number) => void {
  const scope = useContext(MessageMediaScopeContext);
  const viewer = useMediaViewer();
  return useCallback((items: ViewerItem[], index: number) => {
    const item = items[index];
    if (!item) return;
    if (scope) scope.open(item.key, items, index);
    else viewer?.open(items, index);
  }, [scope, viewer]);
}

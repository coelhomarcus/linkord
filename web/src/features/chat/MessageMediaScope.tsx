import { useMemo } from 'react';
import type { ReactNode } from 'react';
import type { ChatMessage } from '@/shared/types/protocol';
import { getCachedLinkPreview } from '@/shared/lib/linkPreviewCache';
import type { ViewerItem } from '@/features/media/viewer/viewerItem';
import { messageViewerItems } from './messageViewerItems';
import { MessageMediaScopeContext, useMediaViewer } from './useMediaViewer';

/** Makes every picture, card and video of one message open as one set in the viewer, with the
 * message's actions. The set is read from the message when opening (not from what is mounted), so
 * a card still loading its preview or a row half off screen changes nothing. */
export function MessageMediaScope({ message, children }: { message: ChatMessage; children: ReactNode }) {
  const viewer = useMediaViewer();
  const value = useMemo(() => ({
    open: (key: string, fallback: ViewerItem[], fallbackIndex: number) => {
      if (!viewer) return;
      const context = { conversationId: message.conversationId, msgId: message.msgId };
      const items = messageViewerItems(message, getCachedLinkPreview);
      const index = items.findIndex((item) => item.key === key);
      if (index < 0) {
        viewer.open(fallback.map((item) => ({ ...item, message: context })), fallbackIndex);
        return;
      }
      // what only the control knows: an inline video's position
      const startAt = fallback[fallbackIndex]?.startAt;
      viewer.open(items.map((item, i) => ({ ...item, message: context, ...(i === index && startAt ? { startAt } : {}) })), index);
    },
  }), [viewer, message]);
  return <MessageMediaScopeContext.Provider value={value}>{children}</MessageMediaScopeContext.Provider>;
}

import { attachmentViewerItem, gifViewerItem } from '@/features/chat/messageViewerItems';
import { directImageViewerItem } from '@/features/media/viewer/embedViewerItems';
import type { ViewerItem } from '@/features/media/viewer/viewerItem';
import type { MediaItem } from '@/shared/api/api';

/** What the viewer shows for an item, or null when it is not a picture, GIF or video. */
export function viewerItemOf(item: MediaItem): ViewerItem | null {
  const { attachment, embed } = item;
  if (attachment) return attachmentViewerItem(attachment);
  if (embed?.kind !== 'image') return null;
  // a picture link through the proxy, as its tile draws it; a KLIPY GIF has no proxied copy
  return item.imageUrl ? directImageViewerItem(embed.url, { src: item.imageUrl }) : gifViewerItem(embed.url);
}

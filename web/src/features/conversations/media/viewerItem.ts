import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from '@/features/chat/ChatAttachment';
import type { ViewerItem } from '@/features/media/MediaCollectionViewer';
import type { MediaItem } from '@/shared/api/api';

/** What the viewer shows for an item, or null when it is not a picture, GIF or video. */
export function viewerItemOf(item: MediaItem): ViewerItem | null {
  const { attachment, embed } = item;
  if (attachment) {
    const src = `/uploads/${attachment.id}`;
    if (IMAGE_MIME_TYPES.has(attachment.mime)) return { src, name: attachment.name };
    if (VIDEO_MIME_TYPES.has(attachment.mime)) return { src, name: attachment.name, kind: 'video' };
    return null;
  }
  return embed?.kind === 'image' ? { src: embed.url, name: 'GIF' } : null;
}

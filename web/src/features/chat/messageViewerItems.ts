import type { LinkPreviewData } from '@/shared/api/api';
import type { ChatAttachment, ChatMessage } from '@/shared/types/protocol';
import { embedViewerItems } from '@/features/media/viewer/embedViewerItems';
import type { ViewerItem } from '@/features/media/viewer/viewerItem';
import { gifMessageUrl } from '@/features/gifs/klipyMedia';
import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from './ChatAttachment';
import { messageEmbedLinks } from './messageEmbedLinks';
import { parseMessage, spoileredLinks } from './messageMarkup';
import { splitAttachments } from './mediaLayout';

/** An uploaded picture or video as the viewer shows it: the original in full, its generated
 * thumbnail in the strip. Null for any other file. */
export function attachmentViewerItem(attachment: ChatAttachment): ViewerItem | null {
  const src = `/uploads/${attachment.id}`;
  const common = {
    key: `att:${attachment.id}`,
    src,
    originalSrc: src,
    width: attachment.width,
    height: attachment.height,
    name: attachment.name,
    size: attachment.size,
    attachmentId: attachment.id,
  };
  if (IMAGE_MIME_TYPES.has(attachment.mime)) {
    const animated = attachment.mime === 'image/gif';
    return {
      ...common,
      // a GIF's generated thumbnail is still; without one, its own file would move in the strip
      thumbSrc: attachment.thumbId ? `/uploads/${attachment.thumbId}` : animated ? undefined : src,
      kind: animated ? 'gif' : 'image',
      animated,
      placeholder: attachment.placeholder ?? null,
    };
  }
  if (VIDEO_MIME_TYPES.has(attachment.mime)) return { ...common, kind: 'video' };
  return null;
}

/** A GIF sent from the picker, straight from KLIPY (no still copy of it may be made). */
export function gifViewerItem(url: string): ViewerItem {
  return { key: `gif:${url}`, src: url, originalSrc: url, kind: 'gif', animated: true, name: 'GIF' };
}

type MessageMedia = Pick<ChatMessage, 'text' | 'embeds' | 'suppressedEmbeds' | 'attachments'>;

/** Everything of a message the viewer can show, in the order the message draws it: its link cards'
 * pictures (a card under a spoiler cover stays out), then its pictures, then its videos. Built when
 * the viewer opens, so a preview fetched since the message arrived is in it. */
export function messageViewerItems(message: MessageMedia, cachedPreview: (url: string) => LinkPreviewData | undefined): ViewerItem[] {
  const items: ViewerItem[] = [];
  const gifUrl = gifMessageUrl(message.text);
  if (gifUrl) {
    items.push(gifViewerItem(gifUrl));
  } else {
    const blocks = parseMessage(message.text);
    const spoilered = spoileredLinks(blocks);
    for (const { link, embed } of messageEmbedLinks(blocks, message.suppressedEmbeds)) {
      if (spoilered.has(link)) continue;
      const preview = message.embeds?.find((stored) => stored.url === embed.url) ?? cachedPreview(embed.url);
      items.push(...embedViewerItems(embed, preview));
    }
  }
  const { visual, files } = splitAttachments(message.attachments ?? []);
  for (const attachment of [...visual, ...files]) {
    const item = attachmentViewerItem(attachment);
    if (item) items.push(item);
  }
  return items;
}

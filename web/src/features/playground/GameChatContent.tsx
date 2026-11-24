import { useTranslation } from 'react-i18next';
import type { ChatAttachment, ChatMessage, PublicUser, RoleSummary } from '@/shared/types/protocol';
import { cn } from '@/shared/lib/utils';
import { ChatMessageText } from '@/features/chat/ChatMessageText';
import { MediaViewerProvider } from '@/features/chat/MediaViewerProvider';
import { attachmentViewerItem } from '@/features/chat/messageViewerItems';
import { stickerLabel } from '@/features/chat/messagePreview';
import { useMediaViewer, useOpenMedia } from '@/features/chat/useMediaViewer';
import type { ViewerItem } from '@/features/media/viewer/viewerItem';
import { stickerImageUrl } from '@/features/stickers/stickersApi';
import { PIXEL_TEXT } from './pixelFont';

// What a message says, as a line of the game chat: its text the way the
// channel shows it (mentions, emojis and the server's own, links in blue and
// underlined, opening in a new tab) but kept on the line, without link preview
// cards; a sticker small under the name; and its pictures and videos as small
// thumbnails that open the media viewer, other files as links to download.

const NO_PROFILE = () => {};

function isVideo(attachment: ChatAttachment): boolean {
  return attachment.mime.startsWith('video/');
}

function GameChatMediaBody({ attachments }: { attachments: ChatAttachment[] }) {
  const { t } = useTranslation('chat');
  const openMedia = useOpenMedia();
  const viewable = attachments.map((attachment) => ({ attachment, item: attachmentViewerItem(attachment) }));
  const items = viewable.flatMap(({ item }) => (item ? [item] : [])) as ViewerItem[];
  const files = viewable.filter(({ item }) => !item).map(({ attachment }) => attachment);
  const thumb = 'relative block h-20 max-w-40 flex-none overflow-hidden border-2 border-black/70 bg-black/40 outline-none focus-visible:border-white';
  return (
    <span className="mt-1 flex flex-col gap-1">
      {items.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {viewable.filter(({ item }) => item).map(({ attachment }, index) => (
            <button key={attachment.id} type="button" aria-label={t('media.open', { name: attachment.name })} onClick={() => openMedia(items, index)} className={cn(thumb, 'cursor-zoom-in')}>
              {isVideo(attachment) ? (
                <>
                  <video src={`/uploads/${attachment.id}#t=0.1`} preload="metadata" muted playsInline className="block h-full w-auto" />
                  <span aria-hidden className={`absolute inset-0 grid place-items-center ${PIXEL_TEXT.xl} text-white [text-shadow:2px_2px_0_rgb(0_0_0/0.7)]`}>▶</span>
                </>
              ) : (
                <img src={`/uploads/${attachment.thumbId ?? attachment.id}`} alt={attachment.name} draggable={false} className="block h-full w-auto object-cover" />
              )}
            </button>
          ))}
        </span>
      )}
      {files.map((attachment) => (
        <a key={attachment.id} href={`/uploads/${attachment.id}`} download={attachment.name} className="break-all text-link underline">
          {attachment.name}
        </a>
      ))}
    </span>
  );
}

function GameChatMedia({ attachments }: { attachments: ChatAttachment[] }) {
  // the viewer of the chat around, or one of its own where there is none
  if (!useMediaViewer()) return <MediaViewerProvider><GameChatMediaBody attachments={attachments} /></MediaViewerProvider>;
  return <GameChatMediaBody attachments={attachments} />;
}

export function GameChatContent({ message, mentionLookup, myUserId, roles }: {
  message: ChatMessage; mentionLookup: Map<string, PublicUser>; myUserId: string | null; roles?: readonly RoleSummary[];
}) {
  if (message.sticker !== undefined) {
    if (!message.sticker) return <span className="text-white/75">{stickerLabel(null)}</span>;
    return <img src={stickerImageUrl(message.sticker.id)} alt={stickerLabel(message.sticker.name)} draggable={false} className="mt-1 block size-20 object-contain" />;
  }
  return (
    <>
      {message.text && (
        // the message's paragraphs stay on the line, after the name
        <div className="inline [&_a]:underline [&_p]:inline">
          <ChatMessageText text={message.text} mentionLookup={mentionLookup} myUserId={myUserId} onOpenProfile={NO_PROFILE} noPreviews roles={roles} mentionEveryone={!!message.mentionEveryone} />
        </div>
      )}
      {message.attachments?.length ? <GameChatMedia attachments={message.attachments} /> : null}
    </>
  );
}

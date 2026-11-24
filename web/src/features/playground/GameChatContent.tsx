import type { ChatAttachment, ChatMessage, PublicUser, RoleSummary } from '@/shared/types/protocol';
import { ChatMessageText } from '@/features/chat/ChatMessageText';
import { attachmentViewerItem } from '@/features/chat/messageViewerItems';
import { stickerLabel } from '@/features/chat/messagePreview';
import { stickerImageUrl } from '@/features/stickers/stickersApi';
import { PIXEL_TEXT } from './pixelFont';

// What a message says, as a line of the game chat: its text the way the
// channel shows it (mentions, emojis and the server's own, links in blue and
// underlined, opening in a new tab) but kept on the line, without link preview
// cards; a sticker small under the name; its pictures and videos as small
// thumbnails, other files by name. Only links can be clicked: anything else
// that opened (the media viewer, a profile, an emoji's details) would take the
// player out of the game.

function isVideo(attachment: ChatAttachment): boolean {
  return attachment.mime.startsWith('video/');
}

function GameChatMedia({ attachments }: { attachments: ChatAttachment[] }) {
  const media = attachments.filter((attachment) => attachmentViewerItem(attachment));
  const files = attachments.filter((attachment) => !attachmentViewerItem(attachment));
  const thumb = 'relative block h-20 max-w-40 flex-none overflow-hidden border-2 border-black/70 bg-black/40';
  return (
    <span className="mt-1 flex flex-col gap-1">
      {media.length > 0 && (
        <span className="flex flex-wrap gap-1">
          {media.map((attachment) => (
            <span key={attachment.id} className={thumb}>
              {isVideo(attachment) ? (
                <>
                  <video src={`/uploads/${attachment.id}#t=0.1`} preload="metadata" muted playsInline aria-label={attachment.name} className="block h-full w-auto" />
                  <span aria-hidden className={`absolute inset-0 grid place-items-center ${PIXEL_TEXT.xl} text-white [text-shadow:2px_2px_0_rgb(0_0_0/0.7)]`}>▶</span>
                </>
              ) : (
                <img src={`/uploads/${attachment.thumbId ?? attachment.id}`} alt={attachment.name} draggable={false} className="block h-full w-auto object-cover" />
              )}
            </span>
          ))}
        </span>
      )}
      {files.map((attachment) => (
        <span key={attachment.id} className="break-all text-white/75">{attachment.name}</span>
      ))}
    </span>
  );
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
          <ChatMessageText text={message.text} mentionLookup={mentionLookup} myUserId={myUserId} noPreviews linksOnly roles={roles} mentionEveryone={!!message.mentionEveryone} />
        </div>
      )}
      {message.attachments?.length ? <GameChatMedia attachments={message.attachments} /> : null}
    </>
  );
}

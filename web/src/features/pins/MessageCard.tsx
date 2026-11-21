import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowBendUpLeftIcon } from '@/shared/ui/icons';

import { Avatar } from '@/shared/Avatar';
import { ChatMessageText } from '@/features/chat/ChatMessageText';
import { MessageMedia } from '@/features/chat/MessageMedia';
import { MessageMediaScope } from '@/features/chat/MessageMediaScope';
import { StickerMessage } from '@/features/stickers/StickerMessage';
import { stickerLabel } from '@/features/chat/messagePreview';
import { customEmojisAsText } from '@/features/emoji/customEmojiText';
import { roleMentionsAsText } from '@/features/chat/roleMentionText';
import { EmojiText } from '@/features/emoji/Emoji';
import { memberColor } from '@/features/servers/serverUtils';
import { buildMentionLookup } from '@/shared/lib/mentions';
import { formatTime } from '@/shared/lib/formatChatTime';
import { useTimeFormat } from '@/shared/lib/timeFormat';
import { useLanguage } from '@/shared/i18n/useLanguage';
import { useRoom, useRoomState } from '@/state/RoomContext';
import type { ChatMessage } from '@/shared/types/protocol';

/** A message drawn on its own, outside the timeline: a boxed card with its
 * author, time, what it answers, and its content. `actions` sit over its top
 * right corner and show on hover or focus (Discord's "Ir para mensagem"). */
export function MessageCard({ message, actions, onOpenProfile }: { message: ChatMessage; actions?: ReactNode; onOpenProfile?: (userId: string) => void }) {
  const { t } = useTranslation('chat');
  const language = useLanguage();
  const timeFormat = useTimeFormat();
  const { allUsers, servers, conversations, serverMemberRoleIds } = useRoom('allUsers', 'servers', 'conversations', 'serverMemberRoleIds');
  const { me } = useRoomState('me');
  const author = message.id ? allUsers.get(message.id) : undefined;
  const name = author?.displayName ?? message.name;
  const conversation = conversations.find((c) => c.id === message.conversationId);
  const server = conversation?.serverId ? servers.find((s) => s.id === conversation.serverId) : undefined;
  const roleIds = message.id && server ? serverMemberRoleIds?.get(server.id)?.get(message.id) ?? [] : [];
  const nameColor = server ? memberColor(server, roleIds) : '';
  const replyAuthor = message.replyTo?.authorId ? allUsers.get(message.replyTo.authorId) : undefined;
  const mentionLookup = buildMentionLookup(allUsers);

  return (
    <article className="group/card relative flex gap-3 rounded-lg border border-border-default bg-bg-primary px-3 py-2.5 focus-within:border-border-strong">
      <div className="w-10 flex-none">
        {message.id && onOpenProfile ? (
          <button type="button" onClick={() => onOpenProfile(message.id!)} className="mt-0.5 block rounded-full focus-ring">
            <Avatar id={message.id} name={name} avatar={author?.avatar ?? message.avatar} poster={author?.avatarPoster} animateOnHover avatarColor={author?.avatarColor} size={40} />
          </button>
        ) : (
          <Avatar id={message.id ?? message.name} name={name} avatar={author?.avatar ?? message.avatar} avatarColor={author?.avatarColor ?? null} size={40} className="mt-0.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        {message.replyTo && (
          <p className="mb-0.5 flex max-w-full items-center gap-1.5 truncate text-caption text-text-muted">
            <ArrowBendUpLeftIcon size={12} className="flex-none -scale-x-100" aria-hidden />
            <span className="flex-none font-medium text-text-secondary">{replyAuthor ? `@${replyAuthor.displayName}` : t('deletedAuthor')}</span>
            {message.replyTo.text && <span className="truncate"><EmojiText text={roleMentionsAsText(customEmojisAsText(message.replyTo.text), servers)} /></span>}
            {message.replyTo.sticker !== undefined && <span className="truncate">{stickerLabel(message.replyTo.sticker)}</span>}
          </p>
        )}
        <div className="flex items-baseline gap-2">
          <span className="truncate text-body font-medium text-text-primary" style={nameColor ? { color: nameColor } : undefined}>{name}</span>
          <time className="flex-none text-caption text-text-muted" dateTime={new Date(message.ts).toISOString()}>{formatTime(message.ts, language, timeFormat)}</time>
        </div>
        <MessageMediaScope message={message}>
          {message.sticker !== undefined ? (
            <StickerMessage sticker={message.sticker} />
          ) : (
            <>
              {message.text && (
                <div className="text-body leading-5.5 text-text-secondary">
                  <ChatMessageText
                    text={message.text}
                    mentionLookup={mentionLookup}
                    myUserId={me.userId}
                    onOpenProfile={onOpenProfile ?? (() => {})}
                    embeds={message.embeds}
                    suppressedEmbeds={message.suppressedEmbeds}
                    roles={server?.roles}
                    mentionEveryone={!!message.mentionEveryone}
                  />
                </div>
              )}
              {message.attachments?.length ? <MessageMedia attachments={message.attachments} /> : null}
            </>
          )}
        </MessageMediaScope>
      </div>
      {actions && (
        <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 transition-opacity duration-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 touch-first:opacity-100">
          {actions}
        </div>
      )}
    </article>
  );
}

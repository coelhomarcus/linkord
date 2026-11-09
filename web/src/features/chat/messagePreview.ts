import { i18n } from '@/shared/i18n/init';
import type { ChatMessage } from '@/shared/types/protocol';
import { gifMessageUrl } from '@/features/gifs/klipyMedia';
import { dmCallLine } from './dmCallLine';
import { customEmojisAsText } from '@/features/emoji/customEmojiText';

/** One-line text for a message wherever the body itself can't be shown
 * (sidebar subtitle, desktop notification). Invite cards have an empty
 * `text`, so without this they would read as an attachment. */
export function messagePreviewText(
  message: Pick<ChatMessage, 'text' | 'kind' | 'invitation' | 'callInvite' | 'richEmbeds'> & Partial<Pick<ChatMessage, 'id' | 'name' | 'callDurationSeconds' | 'attachments' | 'sticker'>>,
  viewerId?: string | null,
): string {
  if (message.kind === 'dm_call') {
    return dmCallLine({
      viewerId: viewerId ?? null,
      callerId: message.id ?? null,
      callerName: message.name ?? '',
      durationSeconds: message.callDurationSeconds ?? null,
    }, i18n.getFixedT(null, 'chat'));
  }
  if (message.kind === 'server_invite') {
    return message.invitation ? i18n.t('chat:preview.invite', { title: message.invitation.serverName }) : i18n.t('chat:preview.inviteUnavailable');
  }
  if (message.kind === 'call_invite') {
    return message.callInvite ? i18n.t('chat:preview.callInvite', { title: message.callInvite.channelName }) : i18n.t('chat:preview.callInviteUnavailable');
  }
  if (message.sticker !== undefined) return stickerLabel(message.sticker?.name);
  if (gifMessageUrl(message.text)) return 'GIF';
  if (!message.text && message.attachments?.[0]?.voice) return `🎤 ${i18n.t('voiceMessages:preview')}`;
  // a bot may send only a card: its title says what it's about
  const card = message.richEmbeds?.[0];
  return customEmojisAsText(message.text) || card?.title || card?.description || (card ? i18n.t('chat:preview.notice') : i18n.t('chat:preview.attachment'));
}

/** "Sticker: name", or just "Sticker" once it was deleted. */
export function stickerLabel(name: string | null | undefined): string {
  return name ? i18n.t('chat:preview.sticker', { name }) : i18n.t('chat:preview.stickerUnnamed');
}

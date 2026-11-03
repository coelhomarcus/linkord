import { i18n } from '@/shared/i18n/init';
import type { ChatMessage } from '@/shared/types/protocol';
import { gifMessageUrl } from '@/features/gifs/klipyMedia';

/** One-line text for a message wherever the body itself can't be shown
 * (sidebar subtitle, desktop notification). Invite cards have an empty
 * `text`, so without this they would read as an attachment. */
export function messagePreviewText(message: Pick<ChatMessage, 'text' | 'kind' | 'invitation' | 'callInvite' | 'richEmbeds'>): string {
  if (message.kind === 'server_invite') {
    return message.invitation ? i18n.t('chat:preview.invite', { title: message.invitation.serverName }) : i18n.t('chat:preview.inviteUnavailable');
  }
  if (message.kind === 'call_invite') {
    return message.callInvite ? i18n.t('chat:preview.callInvite', { title: message.callInvite.channelName }) : i18n.t('chat:preview.callInviteUnavailable');
  }
  if (gifMessageUrl(message.text)) return 'GIF';
  // a bot may send only a card: its title says what it's about
  const card = message.richEmbeds?.[0];
  return message.text || card?.title || card?.description || (card ? i18n.t('chat:preview.notice') : i18n.t('chat:preview.attachment'));
}
